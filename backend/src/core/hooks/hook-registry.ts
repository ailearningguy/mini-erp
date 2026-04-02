import type { HookPoint, HookRegistration } from './types';

class HookRegistry {
  private points = new Map<string, HookPoint>();
  private hooks = new Map<string, HookRegistration[]>();

  registerPoint(point: HookPoint): void {
    this.points.set(point.name, point);
  }

  getPoint(name: string): HookPoint | undefined {
    return this.points.get(name);
  }

  register(hook: HookRegistration): void {
    const key = `${hook.point}:${hook.phase}`;
    const list = this.hooks.get(key) ?? [];
    list.push(hook);
    this.hooks.set(key, list);
  }

  getHooks(pointName: string, phase: 'pre' | 'post'): HookRegistration[] {
    return this.hooks.get(`${pointName}:${phase}`) ?? [];
  }

  getAllHooks(): HookRegistration[] {
    const result: HookRegistration[] = [];
    for (const hooks of this.hooks.values()) {
      result.push(...hooks);
    }
    return result;
  }

  clearByModule(moduleName: string): void {
    for (const [key, hooks] of this.hooks) {
      const filtered = hooks.filter(h => h.module !== moduleName);
      if (filtered.length === 0) {
        this.hooks.delete(key);
      } else {
        this.hooks.set(key, filtered);
      }
    }
  }

  clearByPlugin(pluginName: string): void {
    for (const [key, hooks] of this.hooks) {
      const filtered = hooks.filter(h => h.plugin !== pluginName);
      if (filtered.length === 0) {
        this.hooks.delete(key);
      } else {
        this.hooks.set(key, filtered);
      }
    }
  }

  clear(): void {
    this.hooks.clear();
    this.points.clear();
  }
}

export { HookRegistry };