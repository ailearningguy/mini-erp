import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { inventory } from './inventory.schema';
import type { IInventoryService, InventoryRecord, ReserveItem } from './interfaces/inventory.service.interface';
import { InventoryReservedEventSchema, InventoryReleasedEventSchema, InventoryAdjustedEventSchema } from './events/inventory.events';
import { EventBus } from '@core/event-bus/event-bus';
import { AppError, ErrorCode } from '@shared/errors';
import type { Db } from '@shared/types/db';

class InventoryService implements IInventoryService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: EventBus,
  ) {}

  async getByProductId(productId: string): Promise<InventoryRecord | null> {
    const result = await this.db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, productId))
      .limit(1);

    if (!result[0]) return null;

    return {
      id: result[0].id,
      productId: result[0].productId,
      quantity: result[0].quantity,
      reserved: result[0].reserved,
      version: result[0].version,
      updatedAt: result[0].updatedAt,
    };
  }

  async reserve(orderId: string, items: ReserveItem[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        const record = await tx
          .select()
          .from(inventory)
          .where(eq(inventory.productId, item.productId))
          .limit(1);

        if (!record[0]) {
          throw new AppError(
            ErrorCode.NOT_FOUND,
            `Inventory not found for product: ${item.productId}`,
            404,
          );
        }

        const available = record[0].quantity - record[0].reserved;
        if (available < item.quantity) {
          throw new AppError(
            ErrorCode.CONFLICT,
            `Insufficient stock for product ${item.productId}: available ${available}, requested ${item.quantity}`,
            409,
            { productId: item.productId, available, requested: item.quantity },
          );
        }

        await tx
          .update(inventory)
          .set({
            reserved: record[0].reserved + item.quantity,
            version: record[0].version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventory.productId, item.productId),
              eq(inventory.version, record[0].version),
            ),
          );
      }

      await this.eventBus.emit(
        InventoryReservedEventSchema.parse({
          id: randomUUID(),
          type: 'inventory.reserved.v1',
          source: 'inventory-service',
          timestamp: new Date().toISOString(),
          aggregate_id: orderId,
          payload: { orderId, items },
          metadata: { version: 'v1' },
        }),
        tx,
      );
    });
  }

  async release(orderId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.eventBus.emit(
        InventoryReleasedEventSchema.parse({
          id: randomUUID(),
          type: 'inventory.released.v1',
          source: 'inventory-service',
          timestamp: new Date().toISOString(),
          aggregate_id: orderId,
          payload: { orderId, reason: 'order-cancelled' },
          metadata: { version: 'v1' },
        }),
        tx,
      );
    });
  }

  async adjust(productId: string, quantity: number): Promise<InventoryRecord> {
    const existing = await this.getByProductId(productId);

    return this.db.transaction(async (tx) => {
      if (existing) {
        const previousQuantity = existing.quantity;
        await tx
          .update(inventory)
          .set({
            quantity,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(inventory.productId, productId));

        await this.eventBus.emit(
          InventoryAdjustedEventSchema.parse({
            id: randomUUID(),
            type: 'inventory.adjusted.v1',
            source: 'inventory-service',
            timestamp: new Date().toISOString(),
            aggregate_id: productId,
            payload: { productId, previousQuantity, newQuantity: quantity },
            metadata: { version: 'v1' },
          }),
          tx,
        );

        return { ...existing, quantity, version: existing.version + 1, updatedAt: new Date() };
      } else {
        const id = randomUUID();
        await tx.insert(inventory).values({
          id,
          productId,
          quantity,
          reserved: 0,
          version: 1,
        });

        await this.eventBus.emit(
          InventoryAdjustedEventSchema.parse({
            id: randomUUID(),
            type: 'inventory.adjusted.v1',
            source: 'inventory-service',
            timestamp: new Date().toISOString(),
            aggregate_id: productId,
            payload: { productId, previousQuantity: 0, newQuantity: quantity },
            metadata: { version: 'v1' },
          }),
          tx,
        );

        return { id, productId, quantity, reserved: 0, version: 1, updatedAt: new Date() };
      }
    });
  }
}

export { InventoryService };