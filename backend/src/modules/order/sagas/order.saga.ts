import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import type { SagaDefinition, ISagaStep } from '@core/saga/saga-orchestrator';
import { SAGA_CONSTANTS } from '@shared/constants';

interface OrderContext {
  orderId: string;
  customerId: string;
  items: { productId: string; quantity: number; price: number }[];
  totalAmount: number;
  paymentMethod: string;
  paymentTransactionId?: string;
  inventoryReservations?: string[];
}

const validateOrderStep: ISagaStep<OrderContext> = {
  name: 'validate',
  timeout: 5000,
  retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
  async execute(ctx: OrderContext): Promise<void> {
    if (!ctx.items || ctx.items.length === 0) {
      throw new Error('Order must have at least one item');
    }
    if (ctx.totalAmount <= 0) {
      throw new Error('Order total must be positive');
    }
  },
  async compensate(_ctx: OrderContext): Promise<void> {
    // No compensation needed for validation
  },
};

const reserveInventoryStep: ISagaStep<OrderContext> = {
  name: 'reserve-inventory',
  timeout: SAGA_CONSTANTS.DEFAULT_STEP_TIMEOUT_MS,
  retry: { maxAttempts: 2, backoffMs: 1000, retryableErrors: ['TIMEOUT'] },
  async execute(ctx: OrderContext): Promise<void> {
    ctx.inventoryReservations = ctx.items.map(
      (item) => `res_${item.productId}_${Date.now()}`,
    );
  },
  async compensate(ctx: OrderContext): Promise<void> {
    ctx.inventoryReservations = [];
  },
};

const chargePaymentStep: ISagaStep<OrderContext> = {
  name: 'charge-payment',
  timeout: SAGA_CONSTANTS.DEFAULT_STEP_TIMEOUT_MS,
  retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: ['TIMEOUT'] },
  async execute(ctx: OrderContext): Promise<void> {
    ctx.paymentTransactionId = `txn_${Date.now()}`;
  },
  async compensate(ctx: OrderContext): Promise<void> {
    ctx.paymentTransactionId = undefined;
  },
};

const confirmOrderStep: ISagaStep<OrderContext> = {
  name: 'confirm-order',
  timeout: 5000,
  retry: { maxAttempts: 3, backoffMs: 1000, retryableErrors: ['TIMEOUT', 'CONFLICT'] },
  async execute(_ctx: OrderContext): Promise<void> {
    // Update order status to confirmed
  },
  async compensate(_ctx: OrderContext): Promise<void> {
    // Revert order status
  },
};

function createOrderSagaDefinition(ctx: OrderContext): SagaDefinition<OrderContext> {
  return {
    name: 'create-order',
    aggregateId: ctx.orderId,
    steps: [
      validateOrderStep,
      reserveInventoryStep,
      chargePaymentStep,
      confirmOrderStep,
    ],
    maxRetries: SAGA_CONSTANTS.DEFAULT_MAX_RETRIES,
    retryDelayMs: SAGA_CONSTANTS.DEFAULT_RETRY_DELAY_MS,
  };
}

export { createOrderSagaDefinition, SagaOrchestrator };
export type { OrderContext };