/**
 * Order module — placeholder for future implementation.
 * Contains order saga definition. Full CRUD will be added when
 * the order module is implemented.
 */

class OrderModule {
  registerWithRegistry(
    registry: { registerRateLimits: (mod: string, cfgs: { eventType: string; maxEventsPerSecond: number }[]) => void },
  ): void {
    registry.registerRateLimits('order', [
      { eventType: 'order.created.v1', maxEventsPerSecond: 100 },
      { eventType: 'order.completed.v1', maxEventsPerSecond: 100 },
    ]);
  }
}

export { OrderModule };