import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ModuleMetadata } from '@core/di/container';

const mockReaddir = jest.fn<() => Promise<{ name: string; isDirectory: () => boolean }[]>>();
const mockReadFile = jest.fn<(path: string) => Promise<string>>();

jest.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}));

import { FsModuleRegistry } from '@core/module-registry/registry';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('FsModuleRegistry', () => {
  let registry: FsModuleRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new FsModuleRegistry('/fake/modules', mockLogger);
  });

  describe('scan()', () => {
    it('should discover enabled modules from filesystem', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
        { name: 'order', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true, dependencies: [] });
        }
        if (path.includes('order/module.json')) {
          return JSON.stringify({ name: 'order', version: '2026.04.01', enabled: true, dependencies: ['product'] });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();

      expect(modules).toHaveLength(2);
      expect(modules[0].name).toBe('product');
      expect(modules[1].name).toBe('order');
    });

    it('should skip disabled modules', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
        { name: 'old-module', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true });
        }
        if (path.includes('old-module/module.json')) {
          return JSON.stringify({ name: 'old-module', version: '2026.04.01', enabled: false });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('product');
    });

    it('should skip directories without module.json', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
        { name: 'utils', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
    });

    it('should skip non-directory entries', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'README.md', isDirectory: () => false },
        { name: 'product', isDirectory: () => true },
      ]);
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.includes('product/module.json')) {
          return JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true });
        }
        throw new Error('ENOENT');
      });

      const modules = await registry.scan();
      expect(modules).toHaveLength(1);
    });
  });

  describe('resolve()', () => {
    it('should topologically sort by dependencies', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'order', version: '2026.04.01', enabled: true,
          dependencies: [{ name: 'product', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'order', version: '2026.04.01', enabled: true },
        },
        {
          name: 'product', version: '2026.04.01', enabled: true,
          dependencies: [],
          entry: async () => ({} as any),
          manifest: { name: 'product', version: '2026.04.01', enabled: true },
        },
      ];

      const resolved = registry.resolve(mods);

      expect(resolved[0].name).toBe('product');
      expect(resolved[1].name).toBe('order');
    });

    it('should detect circular dependencies', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'a', version: '1', enabled: true,
          dependencies: [{ name: 'b', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'a', version: '1', enabled: true },
        },
        {
          name: 'b', version: '1', enabled: true,
          dependencies: [{ name: 'a', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'b', version: '1', enabled: true },
        },
      ];

      expect(() => registry.resolve(mods)).toThrow(/[Cc]ircular/);
    });

    it('should throw on missing dependency', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'order', version: '1', enabled: true,
          dependencies: [{ name: 'nonexistent', version: '*' }],
          entry: async () => ({} as any),
          manifest: { name: 'order', version: '1', enabled: true },
        },
      ];

      expect(() => registry.resolve(mods)).toThrow(/not found|not available/i);
    });

    it('should handle modules with no dependencies', () => {
      const mods: ModuleMetadata[] = [
        {
          name: 'product', version: '1', enabled: true,
          dependencies: [],
          entry: async () => ({} as any),
          manifest: { name: 'product', version: '1', enabled: true },
        },
      ];

      const resolved = registry.resolve(mods);
      expect(resolved).toHaveLength(1);
    });
  });

  describe('refresh()', () => {
    it('should scan, resolve, and update active set', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true }),
      );

      const resolved = await registry.refresh();

      expect(resolved).toHaveLength(1);
      expect(registry.getActive()).toEqual(resolved);
    });
  });

  describe('getByName()', () => {
    it('should return module by name after refresh', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'product', isDirectory: () => true },
      ]);
      mockReadFile.mockResolvedValue(
        JSON.stringify({ name: 'product', version: '2026.04.01', enabled: true }),
      );

      await registry.refresh();
      const product = registry.getByName('product');

      expect(product?.name).toBe('product');
    });

    it('should return undefined for unknown module', async () => {
      await registry.refresh();
      expect(registry.getByName('unknown')).toBeUndefined();
    });
  });
});