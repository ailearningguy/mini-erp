import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PluginManifest, PluginMetadata, PluginRegistry } from './types';

interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

class FsPluginRegistry implements PluginRegistry {
  private active: PluginMetadata[] = [];

  constructor(
    private pluginsDir: string,
    private logger: Logger,
  ) {}

  async scan(): Promise<PluginMetadata[]> {
    let entries;
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch (err) {
      this.logger.error({ dir: this.pluginsDir, err }, 'Failed to read plugins directory');
      return [];
    }

    const plugins: PluginMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(this.pluginsDir, entry.name, 'plugin.json');

      try {
        const content = await fs.readFile(manifestPath, 'utf-8');
        const manifest: PluginManifest = JSON.parse(content);

        if (!manifest.enabled) {
          this.logger.info({ plugin: manifest.name }, 'Plugin disabled, skipping');
          continue;
        }

        if (!manifest.trusted) {
          throw new Error(
            `Plugin "${manifest.name}" is not trusted. `
            + 'Phase 1 plugins MUST have trusted: true',
          );
        }

        plugins.push({
          name: manifest.name,
          version: manifest.version,
          enabled: manifest.enabled,
          trusted: manifest.trusted,
          dependencies: (manifest.dependencies ?? []).map((dep) => ({
            name: dep,
            version: '*',
          })),
          entry: async (): Promise<{ default: import('./types').PluginFactory }> => {
            return await import(path.join(this.pluginsDir, entry.name, manifest.entry));
          },
          manifest,
        });

        this.logger.info({ plugin: manifest.name, version: manifest.version }, 'Plugin discovered');
      } catch (err) {
        if ((err as Error).message.includes('not trusted')) {
          throw err;
        }
        this.logger.warn({ plugin: entry.name, err }, 'Failed to load plugin manifest');
      }
    }

    return plugins;
  }

  resolve(mods: PluginMetadata[]): PluginMetadata[] {
    const modMap = new Map(mods.map((m) => [m.name, m]));
    const sorted: PluginMetadata[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular plugin dependency detected: ${name}`);
      }

      visiting.add(name);
      const mod = modMap.get(name);

      if (!mod) {
        throw new Error(`Plugin "${name}" depends on unknown plugin`);
      }

      for (const dep of mod.dependencies) {
        if (!modMap.has(dep.name)) {
          throw new Error(`Plugin "${name}" depends on "${dep.name}" which is not available`);
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

  getActive(): PluginMetadata[] {
    return [...this.active];
  }

  async refresh(): Promise<PluginMetadata[]> {
    const scanned = await this.scan();
    const resolved = this.resolve(scanned);
    this.active = resolved;
    return resolved;
  }

  getByName(name: string): PluginMetadata | undefined {
    return this.active.find((m) => m.name === name);
  }
}

export { FsPluginRegistry };