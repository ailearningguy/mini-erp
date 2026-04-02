import type { Capability, CapabilityHandler } from './types';

class CapabilityRegistry {
  private capabilities = new Map<string, Capability>();
  private handlers = new Map<string, CapabilityHandler[]>();

  registerCapability(cap: Capability): void {
    if (this.capabilities.has(cap.name)) {
      throw new Error(`Capability "${cap.name}" already registered`);
    }
    this.capabilities.set(cap.name, cap);
  }

  registerHandler(handler: CapabilityHandler): void {
    const cap = this.capabilities.get(handler.capability);
    if (!cap) {
      throw new Error(`Capability "${handler.capability}" not found`);
    }

    if (cap.type === 'pipeline' && handler.stage && cap.stages && !cap.stages.includes(handler.stage)) {
      throw new Error(
        `Invalid stage "${handler.stage}" for capability "${cap.name}". `
        + `Valid: ${cap.stages.join(', ')}`,
      );
    }

    const list = this.handlers.get(handler.capability) ?? [];
    list.push(handler);
    this.handlers.set(handler.capability, list);
  }

  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  getHandlers(name: string): CapabilityHandler[] {
    return this.handlers.get(name) ?? [];
  }

  getAllCapabilities(): Capability[] {
    return [...this.capabilities.values()];
  }

  getAllHandlers(): CapabilityHandler[] {
    const result: CapabilityHandler[] = [];
    for (const handlers of this.handlers.values()) {
      result.push(...handlers);
    }
    return result;
  }

  clearByModule(moduleName: string): void {
    for (const [key, handlers] of this.handlers) {
      const filtered = handlers.filter(h => h.module !== moduleName);
      if (filtered.length === 0) {
        this.handlers.delete(key);
      } else {
        this.handlers.set(key, filtered);
      }
    }
  }

  clearByPlugin(pluginName: string): void {
    for (const [key, handlers] of this.handlers) {
      const filtered = handlers.filter(h => h.plugin !== pluginName);
      if (filtered.length === 0) {
        this.handlers.delete(key);
      } else {
        this.handlers.set(key, filtered);
      }
    }
  }

  clear(): void {
    this.capabilities.clear();
    this.handlers.clear();
  }
}

export { CapabilityRegistry };
