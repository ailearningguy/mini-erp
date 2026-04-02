import type { CapabilityRegistry } from './capability-registry';

function validateCapabilities(registry: CapabilityRegistry): void {
  const capabilities = registry.getCapabilitiesMap();

  for (const [name, cap] of capabilities) {
    const handlers = registry.getHandlers(name);

    if (cap.type === 'single' && handlers.length > 1) {
      throw new Error(
        `Capability "${name}" is single-type but has ${handlers.length} handlers`,
      );
    }

    const exclusive = handlers.filter(h => h.exclusive);
    if (exclusive.length > 1) {
      throw new Error(
        `Capability "${name}" has multiple exclusive handlers: `
        + exclusive.map(h => h.module ?? h.plugin ?? 'unknown').join(', '),
      );
    }

    if (cap.type === 'pipeline' && cap.stages) {
      for (const h of handlers) {
        if (h.stage && !cap.stages.includes(h.stage)) {
          throw new Error(
            `Invalid stage "${h.stage}" for capability "${name}". `
            + `Valid stages: ${cap.stages.join(', ')}`,
          );
        }
      }
    }
  }
}

export { validateCapabilities };
