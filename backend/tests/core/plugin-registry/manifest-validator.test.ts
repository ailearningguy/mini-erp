import { describe, it, expect } from '@jest/globals';
import { validatePluginManifest } from '@core/plugin-registry/manifest-validator';
import type { PluginManifest } from '@core/plugin-registry/types';

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: 'test-plugin',
    version: '2026.04.02',
    description: 'Test plugin',
    enabled: true,
    trusted: true,
    entry: './test.plugin.ts',
    ...overrides,
  };
}

describe('validatePluginManifest', () => {
  it('should accept valid manifest', () => {
    expect(() => validatePluginManifest(makeManifest(), 'test-plugin')).not.toThrow();
  });

  it('should reject manifest without name', () => {
    expect(() => validatePluginManifest(makeManifest({ name: '' }), 'dir')).toThrow(/missing "name"/);
  });

  it('should reject manifest without version', () => {
    expect(() => validatePluginManifest(makeManifest({ version: '' }), 'dir')).toThrow(/missing "version"/);
  });

  it('should reject manifest without entry', () => {
    expect(() => validatePluginManifest(makeManifest({ entry: '' }), 'dir')).toThrow(/missing "entry"/);
  });

  it('should reject untrusted plugin', () => {
    expect(() => validatePluginManifest(makeManifest({ trusted: false }), 'dir')).toThrow(/not trusted/i);
  });

  it('should reject permission with empty actions', () => {
    const manifest = makeManifest({
      permissions: [{ resource: 'product', actions: [] }],
    });
    expect(() => validatePluginManifest(manifest, 'dir')).toThrow(/actions are required/i);
  });

  it('should reject permission without resource', () => {
    const manifest = makeManifest({
      permissions: [{ resource: '', actions: ['read'] }],
    });
    expect(() => validatePluginManifest(manifest, 'dir')).toThrow(/resource.*required/i);
  });

  it('should accept valid permissions', () => {
    const manifest = makeManifest({
      permissions: [
        { resource: 'product', actions: ['read', 'write'] },
        { resource: 'plugin_analytics_*', actions: ['read'] },
      ],
    });
    expect(() => validatePluginManifest(manifest, 'dir')).not.toThrow();
  });
});