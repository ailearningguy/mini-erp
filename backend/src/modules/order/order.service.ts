import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { orders } from './order.schema';
import type { IOrderService, Order } from './interfaces/order.service.interface';
import { OrderCreatedEventSchema, OrderConfirmedEventSchema, OrderCancelledEventSchema } from './events/order.events';
import { EventBus } from '@core/event-bus/event-bus';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import type { HookExecutor } from '@core/hooks/hook-executor';
import { AppError, ErrorCode } from '@shared/errors';
import type { Db } from '@shared/types/db';

class OrderService implements IOrderService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: EventBus,
    private readonly inventoryService: IInventoryService,
    private readonly sagaOrchestrator: SagaOrchestrator,
    private readonly hookExecutor: HookExecutor,
  ) {}

  async getById(id: string): Promise<Order | null> {
    const result = await this.db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (!result[0]) return null;

    return {
      id: result[0].id,
      orderNumber: result[0].orderNumber,
      customerId: result[0].customerId,
      status: result[0].status,
      totalAmount: result[0].totalAmount,
      version: result[0].version,
      createdAt: result[0].createdAt,
      updatedAt: result[0].updatedAt,
    };
  }

  async list(limit: number, cursor?: string): Promise<{ items: Order[]; nextCursor: string | null }> {
    const result = await this.db.select().from(orders).limit(limit);

    return {
      items: result.map(r => ({
        id: r.id,
        orderNumber: r.orderNumber,
        customerId: r.customerId,
        status: r.status,
        totalAmount: r.totalAmount,
        version: r.version,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      nextCursor: null,
    };
  }

  async create(customerId: string, items: { productId: string; quantity: number }[]): Promise<Order> {
    const preCtx = await this.hookExecutor.execute('order.beforeCreate', 'pre', {
      customerId,
      items,
    });

    if (preCtx.data.rejected) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Order rejected by hook', 400);
    }

    const orderId = randomUUID();
    const orderNumber = `ORD-${Date.now()}`;
    const totalAmount = '0.00';

    await this.db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        orderNumber,
        customerId,
        status: 'pending',
        totalAmount,
      });

      await this.eventBus.emit(
        OrderCreatedEventSchema.parse({
          id: randomUUID(),
          type: 'order.created.v1',
          source: 'order-service',
          timestamp: new Date().toISOString(),
          aggregate_id: orderId,
          payload: { orderId, orderNumber, customerId, items },
          metadata: { version: 'v1' },
        }),
        tx,
      );
    });

    const order: Order = {
      id: orderId,
      orderNumber,
      customerId,
      status: 'pending',
      totalAmount,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.hookExecutor.execute('order.afterCreate', 'post', order);

    return order;
  }

  async confirm(orderId: string): Promise<Order> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!existing[0]) {
        throw new AppError(ErrorCode.NOT_FOUND, `Order not found: ${orderId}`, 404);
      }

      await tx
        .update(orders)
        .set({ status: 'confirmed', version: existing[0].version + 1, updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      await this.eventBus.emit(
        OrderConfirmedEventSchema.parse({
          id: randomUUID(),
          type: 'order.confirmed.v1',
          source: 'order-service',
          timestamp: new Date().toISOString(),
          aggregate_id: orderId,
          payload: { orderId, orderNumber: existing[0].orderNumber },
          metadata: { version: 'v1' },
        }),
        tx,
      );

      return {
        ...existing[0],
        status: 'confirmed',
        version: existing[0].version + 1,
        updatedAt: new Date(),
      };
    });
  }

  async cancel(orderId: string): Promise<Order> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!existing[0]) {
        throw new AppError(ErrorCode.NOT_FOUND, `Order not found: ${orderId}`, 404);
      }

      await tx
        .update(orders)
        .set({ status: 'cancelled', version: existing[0].version + 1, updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      await this.eventBus.emit(
        OrderCancelledEventSchema.parse({
          id: randomUUID(),
          type: 'order.cancelled.v1',
          source: 'order-service',
          timestamp: new Date().toISOString(),
          aggregate_id: orderId,
          payload: { orderId, reason: 'user-cancelled' },
          metadata: { version: 'v1' },
        }),
        tx,
      );

      return {
        ...existing[0],
        status: 'cancelled',
        version: existing[0].version + 1,
        updatedAt: new Date(),
      };
    });
  }
}

export { OrderService };