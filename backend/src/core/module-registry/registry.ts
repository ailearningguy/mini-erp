import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ModuleMetadata, ModuleManifest, ModuleFactory } from '@core/di/container';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

interface ModuleRegistryInterface {
  scan(): Promise<ModuleMetadata[]>;
  resolve(mods: ModuleMetadata[]): ModuleMetadata[];
  getActive(): ModuleMetadata[];
  refresh(): Promise<ModuleMetadata[]>;
  getByName(name: string): ModuleMetadata | undefined;
}

class FsModuleRegistry implements ModuleRegistryInterface {
  private active: ModuleMetadata[] = [];

  constructor(
    private modulesDir: string,
    private logger: Logger,
  ) {}

  async scan(): Promise<ModuleMetadata[]> {
    let entries;
    try {
      entries = await fs.readdir(this.modulesDir, { withFileTypes: true });
    } catch (err) {
      this.logger.error({ dir: this.modulesDir, err }, 'Failed to read modules directory');
      return [];
    }

    const modules: ModuleMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(this.modulesDir, entry.name, 'module.json');

      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest: ModuleManifest = JSON.parse(content);

        if (!manifest.enabled) {
          this.logger.info({ module: manifest.name }, 'Module disabled, skipping');
          continue;
        }

        modules.push({
          name: manifest.name,
          version: manifest.version,
          enabled: manifest.enabled,
          dependencies: (manifest.dependencies ?? []).map(dep => ({
            name: dep,
            version: '*',
          })),
          entry: async (): Promise<{ default: ModuleFactory }> => {
            const mod = await import(path.join(this.modulesDir, entry.name, 'index.ts'));
            return mod;
          },
          manifest,
        });

        this.logger.info({ module: manifest.name, version: manifest.version }, 'Module discovered');
      } catch (err) {
        this.logger.warn({ module: entry.name, err }, 'Failed to load module manifest');
      }
    }

    return modules;
  }

  resolve(mods: ModuleMetadata[]): ModuleMetadata[] {
    const modMap = new Map(mods.map(m => [m.name, m]));
    const sorted: ModuleMetadata[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving module: ${name}`);
      }

      visiting.add(name);
      const mod = modMap.get(name);

      if (!mod) {
        throw new Error(`Module "${name}" depends on unknown module`);
      }

      for (const dep of mod.dependencies) {
        if (!modMap.has(dep.name)) {
          throw new Error(`Module "${name}" depends on "${dep.name}" which is not available`);
        }
        visit(dep.name);
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(mod);
    };

    for (const mod of mods) {
      visit(mod.name);
    }

    return sorted;
  }

  getActive(): ModuleMetadata[] {
    return [...this.active];
  }

  async refresh(): Promise<ModuleMetadata[]> {
    const scanned = await this.scan();
    const resolved = this.resolve(scanned);
    this.active = resolved;
    return resolved;
  }

  getByName(name: string): ModuleMetadata | undefined {
    return this.active.find(m => m.name === name);
  }
}

export { FsModuleRegistry };
export type { ModuleRegistryInterface as ModuleRegistry };
export type { ModuleMetadata, ModuleManifest, ModuleFactory } from '@core/di/container';

interface ActiveModule {
  name: string;
  version: string;
  enabled: boolean;
  dependencies: string[];
}

export type { ActiveModule };