type Factory<T = unknown> = () => T;

interface ActivePlugin {
  name: string;
}

interface ServiceRegistration<T = unknown> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
  deps: string[];
}

interface IModule {
  name: string;
  onInit: () => Promise<void>;
  onDestroy: () => Promise<void>;
}

interface IModuleFactory {
  create: () => { providers: Array<{ token: string; factory: Factory }>; module: IModule };
}

interface ModuleMetadata {
  name: string;
  version: string;
  enabled: boolean;
  dependencies: string[];
  entry: () => Promise<IModuleFactory>;
  manifest: { name: string; version: string; enabled: boolean };
}

type ContainerState = 'IDLE' | 'BUILDING' | 'READY' | 'DISPOSING';

const RESTRICTED_TOKEN_PATTERNS = [
  /repository/i,
  /\.schema$/i,
  /schema\./i,
];

class DIContainer {
  private services = new Map<string, ServiceRegistration>();
  private resolving = new Set<string>();
  private currentActor: string = 'core';
  private modules: IModule[] = [];
  private moduleInstances = new Map<string, unknown>();
  private coreInstances = new Map<string, unknown>();
  private containerState: ContainerState = 'IDLE';

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

  registerCore(token: string, definition: { useFactory: () => unknown }): void {
    const factory = definition.useFactory;
    this.services.set(token, { factory, singleton: true, deps: [] });
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

  async rebuild(_plugins: ActivePlugin[]): Promise<void> {
  }

  async build(modules: ModuleMetadata[]): Promise<void> {
    if (this.containerState !== 'IDLE') {
      throw new Error(`Cannot build from state: ${this.containerState}`);
    }
    this.containerState = 'BUILDING';

    for (const metadata of modules) {
      if (!metadata.enabled) continue;

      const factory = await metadata.entry();
      const { providers, module } = factory.create();

      for (const provider of providers) {
        this.register(provider.token, provider.factory);
      }

      await module.onInit();
      this.modules.push(module);
      this.moduleInstances.set(metadata.name, module);
    }

    this.containerState = 'READY';
  }

  async dispose(): Promise<void> {
    await this.disposeInternal();
  }

  private async disposeInternal(): Promise<void> {
    if (this.containerState !== 'READY') return;
    this.containerState = 'DISPOSING';

    for (const m of [...this.modules].reverse()) {
      try { await m.onDestroy(); } catch (err) { console.error(err); }
    }

    for (const [_token, instance] of this.moduleInstances) {
      if (instance && typeof (instance as { dispose?: () => Promise<void> }).dispose === 'function') {
        try { await (instance as { dispose: () => Promise<void> }).dispose(); } catch (err) { console.error(err); }
      }
    }

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

    this.moduleInstances.clear();
    this.modules = [];
    this.containerState = 'IDLE';
  }
}

interface ActivePlugin {
  name: string;
}

export { DIContainer, IModule, IModuleFactory, ModuleMetadata, ActivePlugin };