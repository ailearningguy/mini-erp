import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockFs = {
  readFile: jest.fn((_path: string) => Promise.resolve('')),
  readdir: jest.fn((_path: string) => Promise.resolve([])),
  access: jest.fn((_path: string) => Promise.resolve()),
};

jest.mock('node:fs/promises', () => mockFs);

import { ModuleInstaller } from '@core/module-installer/module-installer';
import type { ActiveModule } from '@core/module-registry/registry';

describe('ModuleInstaller', () => {
  let installer: ModuleInstaller;
  let mocks: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mocks = {
      registry: {
        getByName: jest.fn(),
        getActive: jest.fn().mockReturnValue([]),
      },
      restartManager: {
        restart: jest.fn(),
      },
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };
    installer = new ModuleInstaller(
      mocks.registry,
      mocks.restartManager,
      '/fake/modules',
      mocks.logger,
    );
  });

  describe('install()', () => {
    it('should validate manifest and trigger restart', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        name: 'new-module',
        version: '2026.04.01',
        enabled: true,
        dependencies: [],
      }));
      mockFs.access.mockResolvedValue(undefined);

      await installer.install('new-module');

      expect(mocks.restartManager.restart).toHaveBeenCalledWith('install:new-module');
      expect(mocks.logger.info).toHaveBeenCalledWith(
        { module: 'new-module' },
        'module-installed',
      );
    });

    it('should throw on invalid manifest (missing name)', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        version: '2026.04.01',
        enabled: true,
      }));

      await expect(installer.install('bad-module')).rejects.toThrow(/invalid|missing/i);
    });

    it('should throw when dependency not satisfied', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        name: 'dependent-module',
        version: '2026.04.01',
        enabled: true,
        dependencies: ['nonexistent'],
      }));
      mockFs.access.mockResolvedValue(undefined);
      mocks.registry.getActive.mockReturnValue([]);
      mocks.registry.getByName.mockReturnValue(undefined);

      await expect(installer.install('dependent-module')).rejects.toThrow(/depend|not satisfied/i);
    });
  });

  describe('uninstall()', () => {
    it('should trigger restart for uninstall', async () => {
      mocks.registry.getByName.mockReturnValue({ name: 'test-module', version: '2026.04.01', enabled: true, dependencies: [] } as ActiveModule);

      await installer.uninstall('test-module');

      expect(mocks.restartManager.restart).toHaveBeenCalledWith('uninstall:test-module');
      expect(mocks.logger.info).toHaveBeenCalledWith(
        { module: 'test-module' },
        'module-uninstalled',
      );
    });

    it('should throw when module not found', async () => {
      mocks.registry.getByName.mockReturnValue(undefined);

      await expect(installer.uninstall('unknown')).rejects.toThrow(/not found/i);
    });
  });

  describe('list()', () => {
    it('should return active modules', () => {
      mocks.registry.getActive.mockReturnValue([
        { name: 'product', version: '2026.04.01', enabled: true, dependencies: [] },
        { name: 'order', version: '2026.04.01', enabled: true, dependencies: ['product'] },
      ] as ActiveModule[]);

      const list = installer.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('product');
    });
  });
});
