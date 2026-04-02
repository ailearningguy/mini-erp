type Factory<T = unknown> = () => T;

import type { HookRegistration } from '@core/hooks/types';

interface CapabilityHandlerStub {
  capability: string;
  stage?: string;
  priority?: number;
  exclusive?: boolean;
  module?: string;
  handle: (ctx: unknown) => Promise<void>;
}

interface CapabilityRequirementStub {
  name: string;
  versionRange: string;
  mode: 'required' | 'optional';
}

interface CapabilityContractStub {
  name: string;
  version: string;
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
  compatibility: {
    backwardCompatible: boolean;
  };
  deprecated?: boolean;
  sunsetDate?: string;
}

interface ServiceRegistration<T = unknown> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
  deps: string[];
}

interface IModule {
  readonly name: string;
  onInit(): Promise<void>;
  onDestroy(): Promise<void>;
}

interface ModuleFactory {
  create(container: DIContainer): Promise<ModuleDefinition> | ModuleDefinition;
}

interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];
  hooks?: HookRegistration[];
  capabilities?: CapabilityHandlerStub[];
  contracts?: CapabilityContractStub[];
  requires?: CapabilityRequirementStub[];
  schemas?: Record<string, unknown>;
}

interface ProviderRegistration<T = unknown> {
  token: string;
  useClass?: new (...args: unknown[]) => T;
  useFactory?: (container: DIContainer) => Promise<T> | T;
  deps?: string[];
  scope?: 'singleton' | 'transient';
  moduleName?: string;
  exported?: boolean;
}

interface ModuleMetadata {
  name: string;
  version: string;
  enabled: boolean;
  dependencies: { name: string; version: string }[];
  entry: () => Promise<{ default: ModuleFactory }>;
  manifest: ModuleManifest;
}

interface ModuleManifest {
  name: string;
  version: string;
  enabled: boolean;
  dependencies?: string[];
  description?: string;
}

type ContainerState = 'IDLE' | 'BUILDING' | 'READY' | 'DISPOSING';

const RESTRICTED_TOKEN_PATTERNS = [
  /repository/i,
  /\.schema$/i,
  /schema\./i,
];

interface Disposable {
  dispose(): Promise<void>;
}

function isDisposable(obj: unknown): obj is Disposable {
  const maybeDisposable = obj as Record<string, unknown>;
  return obj !== null && typeof obj === 'object' && 'dispose' in maybeDisposable && typeof maybeDisposable.dispose === 'function';
}

class DIContainer {
  private services = new Map<string, ServiceRegistration>();
  private resolving = new Set<string>();
  private currentActor: string = 'core';

  private coreProviders = new Map<string, ProviderRegistration>();
  private coreInstances = new Map<string, unknown>();
  private moduleProviders = new Map<string, ProviderRegistration>();
  private moduleInstances = new Map<string, unknown>();
  private modules: IModule[] = [];
  private containerState: ContainerState = 'IDLE';
  private buildMutex: Promise<void> = Promise.resolve();
  private pendingHooks: HookRegistration[] = [];
  private pendingCapabilities: CapabilityHandlerStub[] = [];
  private pendingRequirements: CapabilityRequirementStub[] = [];
  private pendingContracts: CapabilityContractStub[] = [];
  private exportedTokens = new Map<string, string>();

  setActor(actor: string): void {
    this.currentActor = actor;
  }

  register<T>(token: string, factory: Factory<T>, deps: string[] = [], singleton = true): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }

    if (this.currentActor.startsWith('plugin:')) {
      for (const pattern of RESTRICTED_TOKEN_PATTERNS) {
        if (pattern.test(token)) {
          throw new Error(
            `Plugin "${this.currentActor}" cannot register "${token}". `
            + 'Plugins must use service interfaces, not repositories or schemas.',
          );
        }
      }
    }

    this.services.set(token, { factory, singleton, deps });
  }

  registerCore<T>(token: string, provider: { useFactory: (container: DIContainer) => Promise<T> | T }): void {
    if (this.coreProviders.has(token) || this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.coreProviders.set(token, { token, useFactory: provider.useFactory, moduleName: '__core__' });
    const instance = provider.useFactory(this);
    this.coreInstances.set(token, instance);
  }

  get<T>(token: string): T {
    if (this.services.has(token)) {
      return this.resolve<T>(token);
    }
    if (this.coreInstances.has(token)) {
      return this.coreInstances.get(token) as T;
    }
    if (this.moduleInstances.has(token)) {
      return this.moduleInstances.get(token) as T;
    }
    throw new Error(`Service not found: ${token}`);
  }

  resolve<T>(token: string): T {
    const registration = this.services.get(token);
    if (!registration) {
      throw new Error(`Service not registered: ${token}`);
    }

    if (registration.singleton && registration.instance !== undefined) {
      return registration.instance as T;
    }

    if (this.resolving.has(token)) {
      throw new Error(
        `Circular dependency detected: ${[...this.resolving, token].join(' -> ')}`,
      );
    }

    this.resolving.add(token);
    try {
      const instance = registration.factory() as T;
      if (registration.singleton) {
        registration.instance = instance;
      }
      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  validateGraph(): void {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (token: string, path: string[]): void => {
      if (visiting.has(token)) {
        const cycleStart = path.indexOf(token);
        cycles.push(path.slice(cycleStart));
        return;
      }
      if (visited.has(token)) return;

      visiting.add(token);
      path.push(token);

      const reg = this.services.get(token);
      if (reg) {
        for (const dep of reg.deps) {
          if (!this.services.has(dep)) {
            throw new Error(`Dependency "${dep}" not registered (required by "${token}")`);
          }
          visit(dep, [...path]);
        }
      }

      path.pop();
      visiting.delete(token);
      visited.add(token);
    };

    for (const token of this.services.keys()) {
      visit(token, []);
    }

    if (cycles.length > 0) {
      const descriptions = cycles.map((c) => c.join(' -> ')).join('\n  ');
      throw new Error(`Circular dependencies detected:\n  ${descriptions}`);
    }
  }

  has(token: string): boolean {
    return this.services.has(token);
  }

  getRegisteredTokens(): string[] {
    return [...this.services.keys()];
  }

  getDependencies(token: string): string[] {
    return this.services.get(token)?.deps ?? [];
  }

  async rebuild(modules: ModuleMetadata[]): Promise<void> {
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      const snapshot = {
        providers: new Map(this.moduleProviders),
        instances: new Map(this.moduleInstances),
        modules: [...this.modules],
        exports: new Map(this.exportedTokens),
        hooks: [...this.pendingHooks],
        capabilities: [...this.pendingCapabilities],
      };

      try {
        await this.disposeInternal();
        await this.buildInternal(modules);
      } catch (err) {
        this.moduleProviders = snapshot.providers;
        this.moduleInstances = snapshot.instances;
        this.modules = snapshot.modules;
        this.exportedTokens = snapshot.exports;
        this.pendingHooks = snapshot.hooks;
        this.pendingCapabilities = snapshot.capabilities;
        this.containerState = 'READY';
        throw new Error(`Rebuild failed, rolled back to previous state: ${err}`);
      }
    } finally {
      release!();
    }
  }

  async build(modules: ModuleMetadata[]): Promise<void> {
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      this.assertContainerState('IDLE');
      this.containerState = 'BUILDING';

      const enabledModules = modules.filter(m => m.enabled);
      const loaded = await Promise.all(
        enabledModules.map(async m => {
          try {
            const mod = await m.entry();
            return { metadata: m, factory: mod.default ?? mod };
          } catch (err) {
            throw new Error(`Failed to load module "${m.name}": ${err}`);
          }
        }),
      );

      for (const { metadata, factory } of loaded) {
        const def = await Promise.resolve(factory.create(this));

        for (const provider of def.providers) {
          provider.moduleName = metadata.name;
          if (this.moduleProviders.has(provider.token)) {
            throw new Error(`Duplicate provider token "${provider.token}" in module "${metadata.name}"`);
          }
          this.moduleProviders.set(provider.token, provider);
        }

        if (def.exports) {
          for (const token of def.exports) {
            this.exportedTokens.set(token, metadata.name);
          }
        }

        if (def.hooks) {
          this.pendingHooks.push(...def.hooks);
        }

        if (def.capabilities) {
          this.pendingCapabilities.push(...def.capabilities);
        }

        if (def.requires) {
          this.pendingRequirements.push(...def.requires);
        }

        if (def.contracts) {
          this.pendingContracts.push(...def.contracts);
        }

        this.modules.push(def.module);
      }

      this.validateExtendedGraph();

      for (const [token, provider] of this.moduleProviders) {
        if (provider.scope !== 'transient') {
          await this.instantiateFromProvider(token, 'module');
        }
      }

      for (const m of this.modules) {
        try {
          await m.onInit();
        } catch (err) {
          throw new Error(`Module "${m.name}" onInit() failed: ${err}`);
        }
      }

      const hookRegistry = this.coreInstances.get('HookRegistry') as import('@core/hooks/hook-registry').HookRegistry | undefined;
      if (hookRegistry) {
        for (const hook of this.pendingHooks) {
          hookRegistry.register(hook);
        }
      }
      this.pendingHooks = [];

      const capabilityRegistry = this.coreInstances.get('CapabilityRegistry') as import('@core/capability/capability-registry').CapabilityRegistry | undefined;
      if (capabilityRegistry) {
        for (const handler of this.pendingCapabilities) {
          capabilityRegistry.registerHandler(handler);
        }
      }
      this.pendingCapabilities = [];

      if (this.pendingRequirements.length > 0) {
        const governanceRegistry = this.coreInstances.get('CapabilityGovernanceRegistry') as import('@core/capability-governance/governance-registry').CapabilityGovernanceRegistry | undefined;
        if (governanceRegistry) {
          const { validateRequirements } = await import('@core/capability-governance/version-resolver');
          validateRequirements(this.pendingRequirements, governanceRegistry);
        }
        this.pendingRequirements = [];
      }

      const governanceRegistry = this.coreInstances.get('CapabilityGovernanceRegistry') as import('@core/capability-governance/governance-registry').CapabilityGovernanceRegistry | undefined;
      if (governanceRegistry) {
        for (const contract of this.pendingContracts) {
          governanceRegistry.registerContract(contract);
        }
      }
      this.pendingContracts = [];

      this.containerState = 'READY';
    } catch (err) {
      this.containerState = 'IDLE';
      this.moduleInstances.clear();
      this.moduleProviders.clear();
      this.modules = [];
      throw err;
    } finally {
      release!();
    }
  }

  async dispose(): Promise<void> {
    const prev = this.buildMutex;
    let release: () => void;
    this.buildMutex = new Promise<void>(r => { release = r; });
    await prev;

    try {
      if (this.containerState !== 'READY') return;

      this.containerState = 'DISPOSING';

      for (const m of [...this.modules].reverse()) {
        try {
          await m.onDestroy();
        } catch (err) {
          console.error(`Module "${m.name}" onDestroy() error:`, err);
        }
      }

      for (const [_token, instance] of this.moduleInstances) {
        if (isDisposable(instance)) {
          try {
            await instance.dispose();
          } catch (err) {
            console.error(`Dispose error for "${_token}":`, err);
          }
        }
      }

      const hookRegistry = this.coreInstances.get('HookRegistry') as import('@core/hooks/hook-registry').HookRegistry | undefined;
      if (hookRegistry) {
        for (const mod of this.modules) {
          hookRegistry.clearByModule(mod.name);
        }
      }

      const capabilityRegistry = this.coreInstances.get('CapabilityRegistry') as import('@core/capability/capability-registry').CapabilityRegistry | undefined;
      if (capabilityRegistry) {
        for (const mod of this.modules) {
          capabilityRegistry.clearByModule(mod.name);
        }
      }

      this.moduleInstances.clear();
      this.moduleProviders.clear();
      this.exportedTokens.clear();
      this.pendingHooks = [];
      this.modules = [];

      if (this.services.has('EventSchemaRegistry')) {
        const schemaReg = this.resolve('EventSchemaRegistry') as { clear?: () => void } | undefined;
        if (schemaReg?.clear) {
          schemaReg.clear();
        }
      }

      if (this.services.has('EventConsumer')) {
        const eventConsumer = this.resolve('EventConsumer') as { unregisterAll?: () => void } | undefined;
        if (eventConsumer?.unregisterAll) {
          eventConsumer.unregisterAll();
        }
      }

      this.containerState = 'IDLE';
    } finally {
      release!();
    }
  }

  getExportedTokens(): Map<string, string> {
    return new Map(this.exportedTokens);
  }

  getPendingHooks(): HookRegistration[] {
    return [...this.pendingHooks];
  }

  private assertContainerState(expected: 'IDLE' | 'READY'): void {
    if (this.containerState !== expected) {
      throw new Error(`Container is ${this.containerState}, expected ${expected}`);
    }
  }

  private async instantiateFromProvider(token: string, scope: 'core' | 'module'): Promise<unknown> {
    const instances = scope === 'core' ? this.coreInstances : this.moduleInstances;
    const providers = scope === 'core' ? this.coreProviders : this.moduleProviders;

    if (instances.has(token)) return instances.get(token);

    const provider = providers.get(token) ?? this.coreProviders.get(token);
    if (!provider) throw new Error(`Provider not found: ${token}`);

    let instance: unknown;
    if (provider.useFactory) {
      instance = await provider.useFactory(this);
    } else if (provider.useClass) {
      const deps = (provider.deps ?? []).map(dep => this.get(dep));
      instance = new provider.useClass(...deps);
    } else {
      throw new Error(`Provider "${token}" has no useClass or useFactory`);
    }

    if (provider.scope !== 'transient') {
      instances.set(token, instance);
    }
    return instance;
  }

  private validateExtendedGraph(): void {
    const allTokens = new Set<string>([
      ...this.coreProviders.keys(),
      ...this.moduleProviders.keys(),
    ]);
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (token: string) => {
      if (visiting.has(token)) {
        throw new Error(`Circular dependency detected: ${token}`);
      }
      if (visited.has(token)) return;

      visiting.add(token);
      const provider = this.coreProviders.get(token) ?? this.moduleProviders.get(token);
      for (const dep of provider?.deps ?? []) {
        if (!allTokens.has(dep)) {
          throw new Error(`Missing dependency: "${dep}" required by "${token}"`);
        }
        visit(dep);
      }
      visiting.delete(token);
      visited.add(token);
    };

    for (const token of allTokens) {
      visit(token);
    }
  }

  private async buildInternal(modules: ModuleMetadata[]): Promise<void> {
    this.assertContainerState('IDLE');
    this.containerState = 'BUILDING';

    const enabledModules = modules.filter(m => m.enabled);
    const loaded = await Promise.all(
      enabledModules.map(async m => {
        try {
          const mod = await m.entry();
          return { metadata: m, factory: mod.default ?? mod };
        } catch (err) {
          throw new Error(`Failed to load module "${m.name}": ${err}`);
        }
      }),
    );

    for (const { metadata, factory } of loaded) {
      const def = await Promise.resolve(factory.create(this));
      for (const provider of def.providers) {
        provider.moduleName = metadata.name;
        this.moduleProviders.set(provider.token, provider);
      }
      if (def.exports) {
        for (const token of def.exports) {
          this.exportedTokens.set(token, metadata.name);
        }
      }
      if (def.capabilities) {
        this.pendingCapabilities.push(...def.capabilities);
      }
      this.modules.push(def.module);
    }

    this.validateExtendedGraph();

    for (const [token, provider] of this.moduleProviders) {
      if (provider.scope !== 'transient') {
        await this.instantiateFromProvider(token, 'module');
      }
    }

    for (const m of this.modules) {
      await m.onInit();
    }

    this.containerState = 'READY';
  }

  private async disposeInternal(): Promise<void> {
    if (this.containerState !== 'READY') return;
    this.containerState = 'DISPOSING';

    for (const m of [...this.modules].reverse()) {
      try { await m.onDestroy(); } catch (err) { console.error(err); }
    }
    for (const [token, instance] of this.moduleInstances) {
      if (isDisposable(instance)) {
        try { await instance.dispose(); } catch (err) { console.error(`Dispose error for "${token}":`, err); }
      }
    }

    const hookRegistry = this.coreInstances.get('HookRegistry') as import('@core/hooks/hook-registry').HookRegistry | undefined;
    if (hookRegistry) {
      for (const mod of this.modules) {
        hookRegistry.clearByModule(mod.name);
      }
    }

    this.moduleInstances.clear();
    this.moduleProviders.clear();
    this.exportedTokens.clear();
    this.pendingHooks = [];
    this.pendingCapabilities = [];
    this.modules = [];
    this.containerState = 'IDLE';
  }
}

export { DIContainer };
export type {
  IModule,
  ModuleFactory,
  ModuleDefinition,
  ProviderRegistration,
  ModuleMetadata,
  ModuleManifest,
};