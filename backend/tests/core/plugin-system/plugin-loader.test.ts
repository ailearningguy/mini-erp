import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PluginLoader, PluginStatus } from '@core/plugin-system/plugin-loader';
import type { IPlugin, PluginMetadata } from '@core/plugin-system/plugin-loader';

function createTestPlugin(overrides: Partial<PluginMetadata> = {}): IPlugin {
  const metadata: PluginMetadata = {
    name: 'test-plugin',
    version: '2026.04.01',
    description: 'Test plugin',
    enabled: true,
    trusted: true,
    ...overrides,
  };

  return {
    getMetadata: () => metadata,
    onActivate: jest.fn(async () => {}),
    onDeactivate: jest.fn(async () => {}),
    dispose: jest.fn(async () => {}),
  };
}

describe('PluginLoader', () => {
  let loader: PluginLoader;

  beforeEach(() => {
    loader = new PluginLoader();
  });

  it('should register a trusted plugin', async () => {
    const plugin = createTestPlugin();
    await loader.register(plugin);
    expect(loader.getStatus('test-plugin')).toBe(PluginStatus.INACTIVE);
  });

  it('should reject untrusted plugin', async () => {
    const plugin = createTestPlugin({ trusted: false });
    await expect(loader.register(plugin)).rejects.toThrow('not trusted');
  });

  it('should reject duplicate registration', async () => {
    const plugin = createTestPlugin();
    await loader.register(plugin);
    await expect(loader.register(plugin)).rejects.toThrow('already registered');
  });

  it('should activate plugin and call onActivate()', async () => {
    const plugin = createTestPlugin();
    await loader.register(plugin);
    await loader.activate('test-plugin');

    expect(plugin.onActivate).toHaveBeenCalled();
    expect(loader.getStatus('test-plugin')).toBe(PluginStatus.ACTIVE);
    expect(loader.getActivePlugins()).toContain('test-plugin');
  });

  it('should not activate disabled plugin', async () => {
    const plugin = createTestPlugin({ enabled: false });
    await loader.register(plugin);
    await expect(loader.activate('test-plugin')).rejects.toThrow('disabled');
  });

  it('should deactivate plugin and call onDeactivate()', async () => {
    const plugin = createTestPlugin();
    await loader.register(plugin);
    await loader.activate('test-plugin');
    await loader.deactivate('test-plugin');

    expect(plugin.onDeactivate).toHaveBeenCalled();
    expect(loader.getStatus('test-plugin')).toBe(PluginStatus.INACTIVE);
  });

  it('should dispose plugin (deactivate first if active, then dispose)', async () => {
    const plugin = createTestPlugin();
    await loader.register(plugin);
    await loader.activate('test-plugin');
    await loader.dispose('test-plugin');

    expect(plugin.onDeactivate).toHaveBeenCalled();
    expect(plugin.dispose).toHaveBeenCalled();
    expect(loader.getStatus('test-plugin')).toBeNull();
  });

  it('should dispose inactive plugin without calling deactivate', async () => {
    const plugin = createTestPlugin();
    await loader.register(plugin);
    await loader.dispose('test-plugin');

    expect(plugin.onDeactivate).not.toHaveBeenCalled();
    expect(plugin.dispose).toHaveBeenCalled();
  });

  it('should set ERROR status when onActivate throws', async () => {
    const plugin = createTestPlugin();
    (plugin.onActivate as jest.Mock).mockRejectedValueOnce(new Error('init failed') as never);
    await loader.register(plugin);

    await expect(loader.activate('test-plugin')).rejects.toThrow('init failed');
    expect(loader.getStatus('test-plugin')).toBe(PluginStatus.ERROR);
  });

  it('should throw when activating unknown plugin', async () => {
    await expect(loader.activate('nonexistent')).rejects.toThrow('not found');
  });
});