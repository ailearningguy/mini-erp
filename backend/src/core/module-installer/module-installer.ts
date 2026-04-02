import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ModuleRegistry, ActiveModule } from '@core/module-registry/registry';
import type { SoftRestartManager } from '@core/restart/soft-restart-manager';

interface ModuleManifest {
  name: string;
  version: string;
  enabled?: boolean;
  dependencies?: string[];
  [key: string]: unknown;
}

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class ModuleInstaller {
  constructor(
    private registry: ModuleRegistry,
    private restartManager: SoftRestartManager,
    private modulesDir: string,
    private logger: Logger,
  ) {}

  async install(moduleName: string): Promise<void> {
    const manifestPath = path.join(this.modulesDir, moduleName, 'module.json');
    const manifest = await this.validateManifest(manifestPath);

    const active = this.registry.getActive();
    for (const dep of manifest.dependencies ?? []) {
      if (!active.some((m) => m.name === dep)) {
        throw new Error(`Dependency "${dep}" not satisfied for module "${moduleName}"`);
      }
    }

    try {
      await fs.access(path.join(this.modulesDir, moduleName));
    } catch {
      throw new Error(`Module directory not found: ${moduleName}`);
    }

    await this.restartManager.restart(`install:${moduleName}`);

    this.logger.info({ module: moduleName }, 'module-installed');
  }

  async uninstall(name: string): Promise<void> {
    const mod = this.registry.getByName(name);
    if (!mod) {
      throw new Error(`Module "${name}" not found in active modules`);
    }

    await this.restartManager.restart(`uninstall:${name}`);
    this.logger.info({ module: name }, 'module-uninstalled');
  }

  list(): ActiveModule[] {
    return this.registry.getActive().map((m) => ({
      name: m.name,
      version: m.version,
      enabled: m.enabled,
      dependencies: m.dependencies,
    }));
  }

  private async validateManifest(manifestPath: string): Promise<ModuleManifest> {
    const content = await fs.readFile(manifestPath, 'utf-8');
    let manifest: ModuleManifest;
    try {
      manifest = JSON.parse(content);
    } catch {
      throw new Error(`Invalid manifest JSON: ${manifestPath}`);
    }

    if (!manifest.name || !manifest.version) {
      throw new Error(`Invalid manifest: missing name or version in ${manifestPath}`);
    }

    return manifest;
  }
}

export { ModuleInstaller };
