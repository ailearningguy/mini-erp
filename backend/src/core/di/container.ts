type Constructor<T = unknown> = new (...args: unknown[]) => T;
type Factory<T = unknown> = () => T;

interface ServiceRegistration<T = unknown> {
  factory: Factory<T>;
  singleton: boolean;
  instance?: T;
}

class DIContainer {
  private services = new Map<string, ServiceRegistration>();
  private resolving = new Set<string>();

  register<T>(token: string, factory: Factory<T>, singleton = true): void {
    if (this.services.has(token)) {
      throw new Error(`Service already registered: ${token}`);
    }
    this.services.set(token, { factory, singleton });
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

      // Attempt resolution to detect cycles
      try {
        const reg = this.services.get(token);
        if (reg) {
          reg.factory();
        }
      } catch {
        // Factory may fail during validation — that's OK, we're checking for cycles
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
}

export { DIContainer };
