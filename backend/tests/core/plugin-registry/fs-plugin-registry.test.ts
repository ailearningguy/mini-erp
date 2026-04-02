import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { PluginMetadata } from '@core/plugin-registry/types';

const mockReaddir = jest.fn<() => Promise<{ name: string; isDirectory: () => boolean }[]>>();
const mockReadFile = jest.fn<(path: string) => Promise<string>>();

jest.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

import { FsPluginRegistry } from '@core/plugin-registry/fs-plugin-registry';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('FsPluginRegistry', () => {
  let registry: FsPluginRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new FsPluginRegistry('/fake/plugins', mockLogger);
  });

  describe('scan()', () => {
    it('should discover enabled plugins from filesystem', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'analytics', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'analytics',
          version: '2026.04.02',
          description: 'Analytics plugin',
          enabled: true,
          trusted: true,
          entry: './analytics.plugin.ts',
          dependencies: [],
        }),
      );

      const plugins = await registry.scan();

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('analytics');
      expect(plugins[0].version).toBe('2026.04.02');
      expect(plugins[0].trusted).toBe(true);
    });

    it('should skip disabled plugins', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'analytics', isDirectory: () => true },
        { name: 'old-plugin', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('analytics/plugin.json')) {
          return JSON.stringify({
            name: 'analytics', version: '2026.04.02', description: 'A', enabled: true, trusted: true, entry: './a.ts',
          });
        }
        if (path.includes('old-plugin/plugin.json')) {
          return JSON.stringify({
            name: 'old-plugin', version: '2026.01.01', description: 'O', enabled: false, trusted: true, entry: './o.ts',
          });
        }
        throw new Error('ENOENT');
      });

      const plugins = await registry.scan();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('analytics');
    });

    it('should skip directories without plugin.json', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'analytics', isDirectory: () => true },
        { name: 'utils', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('analytics/plugin.json')) {
          return JSON.stringify({
            name: 'analytics', version: '2026.04.02', description: 'A', enabled: true, trusted: true, entry: './a.ts',
          });
        }
        throw new Error('ENOENT');
      });

      const plugins = await registry.scan();
      expect(plugins).toHaveLength(1);
    });

    it('should skip non-directory entries', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'README.md', isDirectory: () => false },
        { name: 'analytics', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('analytics/plugin.json')) {
          return JSON.stringify({
            name: 'analytics', version: '2026.04.02', description: 'A', enabled: true, trusted: true, entry: './a.ts',
          });
        }
        throw new Error('ENOENT');
      });

      const plugins = await registry.scan();
      expect(plugins).toHaveLength(1);
    });

    it('should reject untrusted plugins with error', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'untrusted', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'untrusted', version: '1', description: 'U', enabled: true, trusted: false, entry: './u.ts',
        }),
      );

      await expect(registry.scan()).rejects.toThrow(/not trusted/i);
    });

    it('should return empty array when plugins directory does not exist', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT'));

      const plugins = await registry.scan();
      expect(plugins).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('resolve()', () => {
    it('should topologically sort by dependencies', () => {
      const mods: PluginMetadata[] = [
        {
          name: 'notification', version: '1', enabled: true, trusted: true,
          dependencies: [{ name: 'analytics', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'notification', version: '1', description: '', enabled: true, trusted: true, entry: './n.ts' },
        },
        {
          name: 'analytics', version: '1', enabled: true, trusted: true,
          dependencies: [],
          entry: async () => ({} as any),
          manifest: { name: 'analytics', version: '1', description: '', enabled: true, trusted: true, entry: './a.ts' },
        },
      ];

      const resolved = registry.resolve(mods);

      expect(resolved[0].name).toBe('analytics');
      expect(resolved[1].name).toBe('notification');
    });

    it('should detect circular dependencies', () => {
      const mods: PluginMetadata[] = [
        {
          name: 'a', version: '1', enabled: true, trusted: true,
          dependencies: [{ name: 'b', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'a', version: '1', description: '', enabled: true, trusted: true, entry: './a.ts' },
        },
        {
          name: 'b', version: '1', enabled: true, trusted: true,
          dependencies: [{ name: 'a', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'b', version: '1', description: '', enabled: true, trusted: true, entry: './b.ts' },
        },
      ];

      expect(() => registry.resolve(mods)).toThrow(/[Cc]ircular/);
    });

    it('should throw on missing dependency', () => {
      const mods: PluginMetadata[] = [
        {
          name: 'notification', version: '1', enabled: true, trusted: true,
          dependencies: [{ name: 'nonexistent', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'notification', version: '1', description: '', enabled: true, trusted: true, entry: './n.ts' },
        },
      ];

      expect(() => registry.resolve(mods)).toThrow(/not available/i);
    });

    it('should handle plugins with no dependencies', () => {
      const mods: PluginMetadata[] = [
        {
          name: 'analytics', version: '1', enabled: true, trusted: true,
          dependencies: [],
          entry: async () => ({} as any),
          manifest: { name: 'analytics', version: '1', description: '', enabled: true, trusted: true, entry: './a.ts' },
        },
      ];

      const resolved = registry.resolve(mods);
      expect(resolved).toHaveLength(1);
    });
  });

  describe('refresh()', () => {
    it('should scan, resolve, and update active set', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'analytics', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'analytics', version: '2026.04.02', description: 'A', enabled: true, trusted: true, entry: './a.ts',
        }),
      );

      const resolved = await registry.refresh();

      expect(resolved).toHaveLength(1);
      expect(registry.getActive()).toEqual(resolved);
    });
  });

  describe('getByName()', () => {
    it('should return plugin by name after refresh', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'analytics', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          name: 'analytics', version: '2026.04.02', description: 'A', enabled: true, trusted: true, entry: './a.ts',
        }),
      );

      await registry.refresh();
      const plugin = registry.getByName('analytics');

      expect(plugin?.name).toBe('analytics');
    });

    it('should return undefined for unknown plugin', async () => {
      await registry.refresh();
      expect(registry.getByName('unknown')).toBeUndefined();
    });
  });
});