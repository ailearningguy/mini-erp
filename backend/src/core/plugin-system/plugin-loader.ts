interface PluginPermission {
  resource: string;
  actions: string[];
  scope?: string;
}

interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: { name: string; version: string }[];
  enabled: boolean;
  config?: Record<string, unknown>;
  permissions?: PluginPermission[];
  trusted?: boolean;
}

interface IPlugin {
  getMetadata(): PluginMetadata;
  onActivate(): Promise<void>;
  onDeactivate(): Promise<void>;
  dispose(): Promise<void>;
}

enum PluginStatus {
  INACTIVE = 'INACTIVE',
  ACTIVE = 'ACTIVE',
  CRASHED = 'CRASHED',
  ERROR = 'ERROR',
}

interface PluginRegistration {
  plugin: IPlugin;
  status: PluginStatus;
  activatedAt: Date | null;
  lastError: string | null;
}

class PluginLoader {
  private plugins = new Map<string, PluginRegistration>();

  async register(plugin: IPlugin): Promise<void> {
    const metadata = plugin.getMetadata();

    if (this.plugins.has(metadata.name)) {
      throw new Error(`Plugin already registered: ${metadata.name}`);
    }

    if (!metadata.trusted) {
      throw new Error(
        `Plugin "${metadata.name}" is not trusted. `
        + 'Phase 1 plugins MUST be trusted (trusted: true). '
        + 'Untrusted plugins require Phase 2+ isolation.',
      );
    }

    this.validatePermissions(metadata);

    this.plugins.set(metadata.name, {
      plugin,
      status: PluginStatus.INACTIVE,
      activatedAt: null,
      lastError: null,
    });
  }

  async activate(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      throw new Error(`Plugin not found: ${name}`);
    }

    const metadata = registration.plugin.getMetadata();
    if (!metadata.enabled) {
      throw new Error(`Plugin is disabled: ${name}`);
    }

    try {
      await registration.plugin.onActivate();
      registration.status = PluginStatus.ACTIVE;
      registration.activatedAt = new Date();
      registration.lastError = null;
    } catch (error) {
      registration.status = PluginStatus.ERROR;
      registration.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  async deactivate(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      throw new Error(`Plugin not found: ${name}`);
    }

    try {
      await registration.plugin.onDeactivate();
      registration.status = PluginStatus.INACTIVE;
    } catch (error) {
      registration.status = PluginStatus.ERROR;
      registration.lastError = error instanceof Error ? error.message : 'Unknown error';
      throw error;
    }
  }

  async dispose(name: string): Promise<void> {
    const registration = this.plugins.get(name);
    if (!registration) {
      throw new Error(`Plugin not found: ${name}`);
    }

    if (registration.status === PluginStatus.ACTIVE) {
      await this.deactivate(name);
    }

    await registration.plugin.dispose();
    this.plugins.delete(name);
  }

  getStatus(name: string): PluginStatus | null {
    const registration = this.plugins.get(name);
    return registration?.status ?? null;
  }

  getActivePlugins(): string[] {
    return [...this.plugins.entries()]
      .filter(([_, reg]) => reg.status === PluginStatus.ACTIVE)
      .map(([name]) => name);
  }

  private validatePermissions(metadata: PluginMetadata): void {
    if (!metadata.permissions) return;

    for (const perm of metadata.permissions) {
      if (!perm.resource || !perm.actions || perm.actions.length === 0) {
        throw new Error(
          `Invalid permission in plugin "${metadata.name}": resource and actions are required`,
        );
      }
    }
  }
}

class PluginGuard {
  validate(permissions: PluginPermission[], requestedAccess: { resource: string; action: string }): boolean {
    return permissions.some(
      (p) =>
        (p.resource === requestedAccess.resource || this.matchesWildcard(p.resource, requestedAccess.resource)) &&
        p.actions.includes(requestedAccess.action),
    );
  }

  private matchesWildcard(pattern: string, resource: string): boolean {
    if (!pattern.includes('*')) return false;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(resource);
  }
}

export { PluginLoader, PluginGuard, PluginStatus };
export type { IPlugin, PluginMetadata, PluginPermission };
