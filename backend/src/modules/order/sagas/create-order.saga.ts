import type { SagaDefinition, ISagaStep } from '@core/saga/saga-orchestrator';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import type { IOrderService } from '../interfaces/order.service.interface';

interface OrderContext {
  orderId: string;
  customerId: string;
  items: { productId: string; quantity: number }[];
  totalAmount?: number;
}

function createOrderSagaDefinition(
  ctx: OrderContext,
  inventoryService: IInventoryService,
  orderService: IOrderService,
): SagaDefinition<OrderContext> {
  const validateStep: ISagaStep<OrderContext> = {
    name: 'validate',
    timeout: 5000,
    retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
    async execute(orderCtx: OrderContext): Promise<void> {
      if (!orderCtx.items || orderCtx.items.length === 0) {
        throw new Error('Order must have at least one item');
      }
    },
    async compensate(_orderCtx: OrderContext): Promise<void> {
    },
  };

  const reserveInventoryStep: ISagaStep<OrderContext> = {
    name: 'reserve-inventory',
    timeout: 10_000,
    retry: { maxAttempts: 2, backoffMs: 1000, retryableErrors: ['TIMEOUT'] },
    async execute(orderCtx: OrderContext): Promise<void> {
      await inventoryService.reserve(orderCtx.orderId, orderCtx.items);
    },
    async compensate(orderCtx: OrderContext): Promise<void> {
      await inventoryService.release(orderCtx.orderId);
    },
  };

  const confirmOrderStep: ISagaStep<OrderContext> = {
    name: 'confirm-order',
    timeout: 5000,
    retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
    async execute(orderCtx: OrderContext): Promise<void> {
      await orderService.confirm(orderCtx.orderId);
    },
    async compensate(orderCtx: OrderContext): Promise<void> {
      await orderService.cancel(orderCtx.orderId);
    },
  };

  return {
    name: 'create-order',
    aggregateId: ctx.orderId,
    steps: [validateStep, reserveInventoryStep, confirmOrderStep],
    maxRetries: 3,
    retryDelayMs: 60_000,
  };
}

export { createOrderSagaDefinition };
export type { OrderContext };