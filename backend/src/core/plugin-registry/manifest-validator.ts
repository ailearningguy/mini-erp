import type { PluginManifest } from './types';

function validatePluginManifest(manifest: PluginManifest, dirName: string): void {
  if (!manifest.name) {
    throw new Error(`Plugin in "${dirName}" missing "name"`);
  }
  if (!manifest.version) {
    throw new Error(`Plugin "${manifest.name}" missing "version"`);
  }
  if (!manifest.entry) {
    throw new Error(`Plugin "${manifest.name}" missing "entry"`);
  }

  if (!manifest.trusted) {
    throw new Error(
      `Plugin "${manifest.name}" is not trusted. `
      + 'Phase 1 plugins MUST have trusted: true',
    );
  }

  if (manifest.permissions) {
    for (const perm of manifest.permissions) {
      if (!perm.resource) {
        throw new Error(
          `Invalid permission in plugin "${manifest.name}": resource is required`,
        );
      }
      if (!perm.actions || perm.actions.length === 0) {
        throw new Error(
          `Invalid permission in plugin "${manifest.name}": actions are required`,
        );
      }
    }
  }
}

export { validatePluginManifest };