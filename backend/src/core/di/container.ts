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

const RESTRICTED_TOKEN_PATTERNS = [
  /repository/i,
  /\.schema$/i,
  /schema\./i,
];

class DIContainer {
  private services = new Map<string, ServiceRegistration>();
  private resolving = new Set<string>();
  private currentActor: string = 'core';

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
}

interface ActivePlugin {
  name: string;
}

export { DIContainer };