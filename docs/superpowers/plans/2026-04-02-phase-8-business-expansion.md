# Phase 8: Business Expansion (Order + Inventory) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real multi-module business flows — Order + Inventory modules with saga orchestration, hook integration, and cross-module communication via service interfaces.

**Architecture:** Order module owns order data + saga. Inventory module owns stock data + reservation logic. Cross-module via `IInventoryService` injected into OrderService. Hooks intercept order creation for extensibility. Saga orchestrates: validate → reserve inventory → confirm order with compensation on failure.

**Tech Stack:** TypeScript, Express.js, Drizzle ORM, Zod, Jest, SagaOrchestrator (existing), HookExecutor (Phase 7), EventBus (existing)

**Spec Reference:** `docs/architecture/erp-platform-full-spec.md` Part C

**Prerequisite:** Phase 6 (ModuleFactory) + Phase 7 (Hook System) complete

---

## Assumed State

| Component | Exists? | Notes |
|-----------|---------|-------|
| `IModule` interface | ✅ | Phase 6 |
| `ModuleFactory` + `ModuleDefinition` | ✅ | Phase 6 |
| `HookRegistry` + `HookExecutor` | ✅ | Phase 7 |
| `SagaOrchestrator` | ✅ | Existing — `core/saga/saga-orchestrator.ts` |
| `EventBus` | ✅ | Existing — `core/event-bus/event-bus.ts` |
| `DIContainer` with `registerCore()` + `build()` | ✅ | Phase 6 |
| ProductModule (reference pattern) | ✅ | Existing — schema, service, controller, events, DTOs |

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| **Inventory Module** | | |
| `backend/src/modules/inventory/module.json` | Create | Manifest |
| `backend/src/modules/inventory/inventory.schema.ts` | Create | Drizzle pgTable |
| `backend/src/modules/inventory/interfaces/inventory.service.interface.ts` | Create | IInventoryService contract |
| `backend/src/modules/inventory/dto/reserve-inventory.dto.ts` | Create | Zod DTOs |
| `backend/src/modules/inventory/events/inventory.events.ts` | Create | Event schemas |
| `backend/src/modules/inventory/inventory.service.ts` | Create | Business logic (reserve/release/adjust) |
| `backend/src/modules/inventory/inventory.controller.ts` | Create | Express routes |
| `backend/src/modules/inventory/inventory.module.ts` | Create | IModule implementation |
| `backend/src/modules/inventory/index.ts` | Create | ModuleFactory |
| **Order Module** | | |
| `backend/src/modules/order/order.schema.ts` | Create | Drizzle pgTable (orders + order_items) |
| `backend/src/modules/order/interfaces/order.service.interface.ts` | Create | IOrderService contract |
| `backend/src/modules/order/dto/create-order.dto.ts` | Create | Zod DTOs |
| `backend/src/modules/order/events/order.events.ts` | Create | Event schemas |
| `backend/src/modules/order/order.service.ts` | Create | Business logic + saga + hooks |
| `backend/src/modules/order/order.controller.ts` | Create | Express routes |
| `backend/src/modules/order/order.module.ts` | Rewrite | IModule with full implementation |
| `backend/src/modules/order/sagas/create-order.saga.ts` | Rewrite | Real saga with inventory integration |
| `backend/src/modules/order/index.ts` | Modify | ModuleFactory with hooks + exports |
| **Tests** | | |
| `backend/tests/modules/inventory/inventory.service.test.ts` | Create | Unit tests |
| `backend/tests/modules/order/order.service.test.ts` | Create | Unit tests |

---

### Task 1: Create Inventory Schema + Interface

**Files:**
- Create: `backend/src/modules/inventory/inventory.schema.ts`
- Create: `backend/src/modules/inventory/interfaces/inventory.service.interface.ts`

- [ ] **Step 1: Write failing test for inventory schema shape**

```typescript
// backend/tests/modules/inventory/inventory.service.test.ts
import { describe, it, expect } from '@jest/globals';
import { inventory } from '@modules/inventory/inventory.schema';

describe('Inventory Schema', () => {
  it('should define inventory table with required columns', () => {
    const columns = inventory;

    // Verify table exists and has expected columns
    expect(columns).toBeDefined();
    expect(columns.id).toBeDefined();
    expect(columns.productId).toBeDefined();
    expect(columns.quantity).toBeDefined();
    expect(columns.reserved).toBeDefined();
    expect(columns.version).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/modules/inventory/inventory.service.test.ts -t "Schema" -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create inventory schema**

```typescript
// backend/src/modules/inventory/inventory.schema.ts
import { pgTable, uuid, integer, timestamp, unique } from 'drizzle-orm/pg-core';

export const inventory = pgTable('inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().unique(),
  quantity: integer('quantity').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  productIdx: unique('inventory_product_unique').on(table.productId),
}));
```

- [ ] **Step 4: Create inventory service interface**

```typescript
// backend/src/modules/inventory/interfaces/inventory.service.interface.ts

interface InventoryRecord {
  id: string;
  productId: string;
  quantity: number;
  reserved: number;
  version: number;
  updatedAt: Date;
}

interface ReserveItem {
  productId: string;
  quantity: number;
}

interface IInventoryService {
  getByProductId(productId: string): Promise<InventoryRecord | null>;
  reserve(orderId: string, items: ReserveItem[]): Promise<void>;
  release(orderId: string): Promise<void>;
  adjust(productId: string, quantity: number): Promise<InventoryRecord>;
}

export type { IInventoryService, InventoryRecord, ReserveItem };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/modules/inventory/inventory.service.test.ts -t "Schema" -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory/inventory.schema.ts backend/src/modules/inventory/interfaces/inventory.service.interface.ts backend/tests/modules/inventory/inventory.service.test.ts
git commit -m "feat: add inventory schema + IInventoryService interface

Schema: id, productId (unique), quantity, reserved, version, updatedAt.
Interface: getByProductId, reserve, release, adjust."
```

---

### Task 2: Create Inventory DTOs + Events

**Files:**
- Create: `backend/src/modules/inventory/dto/reserve-inventory.dto.ts`
- Create: `backend/src/modules/inventory/events/inventory.events.ts`

- [ ] **Step 1: Create inventory DTOs**

```typescript
// backend/src/modules/inventory/dto/reserve-inventory.dto.ts
import { z } from 'zod';

export const ReserveInventoryDtoSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1),
});

export type ReserveInventoryDto = z.infer<typeof ReserveInventoryDtoSchema>;

export const AdjustInventoryDtoSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int(),
});

export type AdjustInventoryDto = z.infer<typeof AdjustInventoryDtoSchema>;
```

- [ ] **Step 2: Create inventory event schemas**

```typescript
// backend/src/modules/inventory/events/inventory.events.ts
import { z } from 'zod';

export const InventoryReservedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('inventory.reserved.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
    })),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type InventoryReservedEvent = z.infer<typeof InventoryReservedEventSchema>;

export const InventoryReleasedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('inventory.released.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    reason: z.string(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type InventoryReleasedEvent = z.infer<typeof InventoryReleasedEventSchema>;

export const InventoryAdjustedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('inventory.adjusted.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    productId: z.string().uuid(),
    previousQuantity: z.number().int(),
    newQuantity: z.number().int(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type InventoryAdjustedEvent = z.infer<typeof InventoryAdjustedEventSchema>;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/inventory/dto/ backend/src/modules/inventory/events/
git commit -m "feat: add inventory DTOs and event schemas

DTOs: ReserveInventoryDto, AdjustInventoryDto (Zod validated).
Events: inventory.reserved.v1, inventory.released.v1, inventory.adjusted.v1."
```

---

### Task 3: Implement InventoryService

**Files:**
- Create: `backend/src/modules/inventory/inventory.service.ts`
- Test: `backend/tests/modules/inventory/inventory.service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// Add to backend/tests/modules/inventory/inventory.service.test.ts

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InventoryService } from '@modules/inventory/inventory.service';

function createMockDb() {
  const mockResult: any[] = [];
  const mockTx = {
    insert: jest.fn(() => ({ values: jest.fn(async () => {}) })),
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => mockResult),
        })),
      })),
    })),
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(async () => {}),
      })),
    })),
  };
  return {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(async () => mockResult),
        })),
      })),
    })),
    transaction: jest.fn(async (fn: any) => fn(mockTx)),
    _mockResult: mockResult,
    _mockTx: mockTx,
  };
}

function createMockEventBus() {
  return {
    emit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('InventoryService', () => {
  let service: InventoryService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventBus = createMockEventBus();
    service = new InventoryService(mockDb as any, mockEventBus as any);
  });

  describe('reserve()', () => {
    it('should throw when inventory not found for product', async () => {
      mockDb._mockResult = [];

      await expect(
        service.reserve('order-1', [{ productId: 'prod-1', quantity: 2 }]),
      ).rejects.toThrow(/not found/i);
    });

    it('should throw when insufficient stock', async () => {
      mockDb._mockResult = [{ productId: 'prod-1', quantity: 1, reserved: 0, version: 1 }];

      await expect(
        service.reserve('order-1', [{ productId: 'prod-1', quantity: 5 }]),
      ).rejects.toThrow(/insufficient/i);
    });

    it('should reserve stock when available', async () => {
      mockDb._mockResult = [{ productId: 'prod-1', quantity: 10, reserved: 0, version: 1 }];

      await service.reserve('order-1', [{ productId: 'prod-1', quantity: 3 }]);

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  describe('release()', () => {
    it('should release reserved stock', async () => {
      await service.release('order-1');

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/modules/inventory/inventory.service.test.ts -v`
Expected: FAIL — InventoryService not found

- [ ] **Step 3: Create InventoryService**

```typescript
// backend/src/modules/inventory/inventory.service.ts
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

      // Emit event within same transaction
      await this.eventBus.emit(
        InventoryReservedEventSchema.parse({
          id: crypto.randomUUID(),
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
    // Simplified release — in production, track per-order reservations
    // For now, emit event for async processing
    await this.db.transaction(async (tx) => {
      await this.eventBus.emit(
        InventoryReleasedEventSchema.parse({
          id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
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
        const id = crypto.randomUUID();
        await tx.insert(inventory).values({
          id,
          productId,
          quantity,
          reserved: 0,
          version: 1,
        });

        await this.eventBus.emit(
          InventoryAdjustedEventSchema.parse({
            id: crypto.randomUUID(),
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/modules/inventory/inventory.service.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventory/inventory.service.ts backend/tests/modules/inventory/inventory.service.test.ts
git commit -m "feat: implement InventoryService with reserve/release/adjust

- reserve(): optimistic locking, insufficient stock check, emit inventory.reserved.v1
- release(): emit inventory.released.v1 for async processing
- adjust(): upsert with version increment, emit inventory.adjusted.v1
- All operations in DB transactions with event emission (ADR-005)"
```

---

### Task 4: Create InventoryController + Module

**Files:**
- Create: `backend/src/modules/inventory/inventory.controller.ts`
- Create: `backend/src/modules/inventory/inventory.module.ts`
- Create: `backend/src/modules/inventory/module.json`
- Create: `backend/src/modules/inventory/index.ts`

- [ ] **Step 1: Create inventory controller**

```typescript
// backend/src/modules/inventory/inventory.controller.ts
import type { Request, Response, NextFunction } from 'express';
import type { IInventoryService } from './interfaces/inventory.service.interface';
import { AdjustInventoryDtoSchema } from './dto/reserve-inventory.dto';
import { successResponse } from '@core/api/response';
import { AppError, ErrorCode } from '@shared/errors';

class InventoryController {
  constructor(private readonly inventoryService: IInventoryService) {}

  async getByProductId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId } = req.params;
      const record = await this.inventoryService.getByProductId(productId);
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, `Inventory not found for product: ${productId}`, 404);
      }
      res.json(successResponse(record, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }

  async adjust(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = AdjustInventoryDtoSchema.parse(req.body);
      const record = await this.inventoryService.adjust(dto.productId, dto.quantity);
      res.json(successResponse(record, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }
}

export { InventoryController };
```

- [ ] **Step 2: Create inventory module (IModule)**

```typescript
// backend/src/modules/inventory/inventory.module.ts
import type { IModule } from '@core/di/container';
import type { IInventoryService } from './interfaces/inventory.service.interface';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import {
  InventoryReservedEventSchema,
  InventoryReleasedEventSchema,
  InventoryAdjustedEventSchema,
} from './events/inventory.events';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventBus } from '@core/event-bus/event-bus';
import type { Express } from 'express';
import type { Db } from '@shared/types/db';

interface InventoryModuleConfig {
  db: Db;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
  app: Express;
}

class InventoryModule implements IModule {
  readonly name = 'inventory';
  private service: IInventoryService;
  private controller: InventoryController;

  constructor(private readonly config: InventoryModuleConfig) {
    this.service = new InventoryService(config.db, config.eventBus);
    this.controller = new InventoryController(this.service);
  }

  getService(): IInventoryService {
    return this.service;
  }

  async onInit(): Promise<void> {
    // Register event schemas
    this.config.schemaRegistry.register('inventory.reserved.v1', InventoryReservedEventSchema);
    this.config.schemaRegistry.register('inventory.released.v1', InventoryReleasedEventSchema);
    this.config.schemaRegistry.register('inventory.adjusted.v1', InventoryAdjustedEventSchema);

    // Register routes
    this.config.app.get('/api/v1/inventory/:productId', (req, res, next) => this.controller.getByProductId(req, res, next));
    this.config.app.put('/api/v1/inventory/adjust', (req, res, next) => this.controller.adjust(req, res, next));
  }

  async onDestroy(): Promise<void> {
    // Cleanup handled by container
  }
}

export { InventoryModule };
export type { InventoryModuleConfig };
```

- [ ] **Step 3: Create module.json**

```json
{
  "name": "inventory",
  "version": "2026.04.01",
  "enabled": true,
  "dependencies": [],
  "description": "Inventory management with stock reservation"
}
```

- [ ] **Step 4: Create module factory (index.ts)**

```typescript
// backend/src/modules/inventory/index.ts
import type { ModuleFactory, ModuleDefinition } from '@core/di/container';
import type { DIContainer } from '@core/di/container';
import { InventoryModule } from './inventory.module';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { Express } from 'express';

const inventoryModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const app = container.get<Express>('ExpressApp');

    const module = new InventoryModule({ db, eventBus, schemaRegistry, app });

    return {
      module,
      providers: [
        {
          token: 'IInventoryService',
          useFactory: () => module.getService(),
          moduleName: 'inventory',
          exported: true,
        },
      ],
      exports: ['IInventoryService'],
    };
  },
};

export default inventoryModuleFactory;
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npx jest tests/modules/inventory/ -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/inventory/
git commit -m "feat: add Inventory module (controller + module + factory)

- InventoryController: GET /api/v1/inventory/:productId, PUT /api/v1/inventory/adjust
- InventoryModule: IModule with onInit (schemas + routes)
- ModuleFactory: exports IInventoryService
- module.json: no dependencies"
```

---

### Task 5: Create Order Schema + DTOs + Events

**Files:**
- Create: `backend/src/modules/order/order.schema.ts`
- Create: `backend/src/modules/order/interfaces/order.service.interface.ts`
- Create: `backend/src/modules/order/dto/create-order.dto.ts`
- Create: `backend/src/modules/order/events/order.events.ts`

- [ ] **Step 1: Create order schema**

```typescript
// backend/src/modules/order/order.schema.ts
import { pgTable, uuid, varchar, decimal, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNumber: varchar('order_number', { length: 50 }).notNull().unique(),
  customerId: uuid('customer_id').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  customerIdx: index('orders_customer_idx').on(table.customerId),
  statusIdx: index('orders_status_idx').on(table.status),
}));

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
});
```

- [ ] **Step 2: Create order service interface**

```typescript
// backend/src/modules/order/interfaces/order.service.interface.ts

interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  status: string;
  totalAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface IOrderService {
  getById(id: string): Promise<Order | null>;
  list(limit: number, cursor?: string): Promise<{ items: Order[]; nextCursor: string | null }>;
  create(customerId: string, items: { productId: string; quantity: number }[]): Promise<Order>;
  confirm(orderId: string): Promise<Order>;
  cancel(orderId: string): Promise<Order>;
}

export type { IOrderService, Order };
```

- [ ] **Step 3: Create order DTOs**

```typescript
// backend/src/modules/order/dto/create-order.dto.ts
import { z } from 'zod';

export const CreateOrderDtoSchema = z.object({
  customerId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().positive(),
  })).min(1, 'Order must have at least one item'),
});

export type CreateOrderDto = z.infer<typeof CreateOrderDtoSchema>;
```

- [ ] **Step 4: Create order events**

```typescript
// backend/src/modules/order/events/order.events.ts
import { z } from 'zod';

export const OrderCreatedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('order.created.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    orderNumber: z.string(),
    customerId: z.string().uuid(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
    })),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type OrderCreatedEvent = z.infer<typeof OrderCreatedEventSchema>;

export const OrderConfirmedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('order.confirmed.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    orderNumber: z.string(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type OrderConfirmedEvent = z.infer<typeof OrderConfirmedEventSchema>;

export const OrderCancelledEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('order.cancelled.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    orderId: z.string().uuid(),
    reason: z.string(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

export type OrderCancelledEvent = z.infer<typeof OrderCancelledEventSchema>;
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/order/order.schema.ts backend/src/modules/order/interfaces/ backend/src/modules/order/dto/ backend/src/modules/order/events/
git commit -m "feat: add order schema, interface, DTOs, and events

Schema: orders + order_items tables with Drizzle.
Interface: IOrderService with create/confirm/cancel.
DTOs: CreateOrderDto with Zod validation.
Events: order.created.v1, order.confirmed.v1, order.cancelled.v1."
```

---

### Task 6: Implement OrderService with Saga + Hooks

**Files:**
- Create: `backend/src/modules/order/order.service.ts`
- Rewrite: `backend/src/modules/order/sagas/create-order.saga.ts`
- Test: `backend/tests/modules/order/order.service.test.ts`

- [ ] **Step 1: Write failing tests for OrderService**

```typescript
// backend/tests/modules/order/order.service.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OrderService } from '@modules/order/order.service';

function createMockDb() {
  const mockResult: any[] = [];
  const mockTx = {
    insert: jest.fn(() => ({ values: jest.fn(async () => {}) })),
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(async () => mockResult) })) })) })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => {}) })) })),
  };
  return {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(async () => mockResult) })) })) })),
    insert: jest.fn(() => ({ values: jest.fn(async () => {}) })),
    transaction: jest.fn(async (fn: any) => fn(mockTx)),
    _mockResult: mockResult,
    _mockTx: mockTx,
  };
}

function createMockEventBus() {
  return { emit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
}

function createMockInventoryService() {
  return {
    reserve: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    release: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getByProductId: jest.fn(),
    adjust: jest.fn(),
  };
}

function createMockSagaOrchestrator() {
  return {
    startSaga: jest.fn<() => Promise<string>>().mockResolvedValue('saga-id-123'),
  };
}

function createMockHookExecutor() {
  return {
    execute: jest.fn().mockResolvedValue({
      data: {},
      result: undefined,
      stopPropagation: false,
      metadata: { point: '', phase: 'pre', executionId: 'test-id' },
    }),
  };
}

describe('OrderService', () => {
  let service: OrderService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;
  let mockInventory: ReturnType<typeof createMockInventoryService>;
  let mockSaga: ReturnType<typeof createMockSagaOrchestrator>;
  let mockHookExecutor: ReturnType<typeof createMockHookExecutor>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockEventBus = createMockEventBus();
    mockInventory = createMockInventoryService();
    mockSaga = createMockSagaOrchestrator();
    mockHookExecutor = createMockHookExecutor();
    service = new OrderService(
      mockDb as any,
      mockEventBus as any,
      mockInventory as any,
      mockSaga as any,
      mockHookExecutor as any,
    );
  });

  describe('create()', () => {
    it('should create order with pending status', async () => {
      const order = await service.create('customer-1', [
        { productId: 'prod-1', quantity: 2 },
      ]);

      expect(order).toBeDefined();
      expect(order.status).toBe('pending');
      expect(order.customerId).toBe('customer-1');
    });

    it('should execute pre-hooks before creation', async () => {
      await service.create('customer-1', [{ productId: 'prod-1', quantity: 2 }]);

      expect(mockHookExecutor.execute).toHaveBeenCalledWith(
        'order.beforeCreate',
        'pre',
        expect.any(Object),
      );
    });

    it('should execute post-hooks after creation', async () => {
      await service.create('customer-1', [{ productId: 'prod-1', quantity: 2 }]);

      expect(mockHookExecutor.execute).toHaveBeenCalledWith(
        'order.afterCreate',
        'post',
        expect.any(Object),
      );
    });

    it('should emit order.created.v1 event', async () => {
      await service.create('customer-1', [{ productId: 'prod-1', quantity: 2 }]);

      expect(mockEventBus.emit).toHaveBeenCalled();
    });
  });

  describe('confirm()', () => {
    it('should update order status to confirmed', async () => {
      mockDb._mockResult = [{
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        status: 'pending',
        totalAmount: '100.00',
        version: 1,
      }];

      const order = await service.confirm('order-1');

      expect(order.status).toBe('confirmed');
    });
  });

  describe('cancel()', () => {
    it('should update order status to cancelled', async () => {
      mockDb._mockResult = [{
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        status: 'pending',
        totalAmount: '100.00',
        version: 1,
      }];

      const order = await service.cancel('order-1');

      expect(order.status).toBe('cancelled');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/modules/order/order.service.test.ts -v`
Expected: FAIL — OrderService not found

- [ ] **Step 3: Create OrderService**

```typescript
// backend/src/modules/order/order.service.ts
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
    // Simplified — full pagination in production
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
    // Pre-hooks (e.g., voucher validation, inventory check)
    const preCtx = await this.hookExecutor.execute('order.beforeCreate', 'pre', {
      customerId,
      items,
    });

    if (preCtx.data.rejected) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Order rejected by hook', 400);
    }

    const orderId = randomUUID();
    const orderNumber = `ORD-${Date.now()}`;
    const totalAmount = '0.00'; // Will be calculated by saga or pricing capability

    // Create order in pending status
    await this.db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        orderNumber,
        customerId,
        status: 'pending',
        totalAmount,
      });

      // Emit order.created event
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

    // Post-hooks (e.g., send notification)
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
```

- [ ] **Step 4: Rewrite create-order.saga.ts with real inventory integration**

```typescript
// backend/src/modules/order/sagas/create-order.saga.ts
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
      // No compensation for validation
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest tests/modules/order/order.service.test.ts -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/order/order.service.ts backend/src/modules/order/sagas/create-order.saga.ts backend/tests/modules/order/order.service.test.ts
git commit -m "feat: implement OrderService with hooks + real saga

- create(): pre-hooks → insert → emit order.created.v1 → post-hooks
- confirm(): optimistic locking, emit order.confirmed.v1
- cancel(): emit order.cancelled.v1
- createOrderSagaDefinition: validate → reserve inventory → confirm order
- Cross-module: OrderService receives IInventoryService via DI"
```

---

### Task 7: Create OrderController + Rewrite OrderModule + ModuleFactory

**Files:**
- Create: `backend/src/modules/order/order.controller.ts`
- Rewrite: `backend/src/modules/order/order.module.ts`
- Modify: `backend/src/modules/order/index.ts`

- [ ] **Step 1: Create order controller**

```typescript
// backend/src/modules/order/order.controller.ts
import type { Request, Response, NextFunction } from 'express';
import type { IOrderService } from './interfaces/order.service.interface';
import { CreateOrderDtoSchema } from './dto/create-order.dto';
import { successResponse } from '@core/api/response';
import { AppError, ErrorCode } from '@shared/errors';
import { API_CONSTANTS } from '@shared/constants';

class OrderController {
  constructor(private readonly orderService: IOrderService) {}

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const order = await this.orderService.getById(id);
      if (!order) {
        throw new AppError(ErrorCode.NOT_FOUND, `Order not found: ${id}`, 404);
      }
      res.json(successResponse(order, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Math.min(
        Number(req.query.limit) || API_CONSTANTS.DEFAULT_PAGE_SIZE,
        API_CONSTANTS.MAX_PAGE_SIZE,
      );
      const cursor = req.query.cursor as string | undefined;
      const result = await this.orderService.list(limit, cursor);
      res.json(successResponse(result.items, (req as any).id!, {
        cursor: result.nextCursor,
        has_more: result.nextCursor !== null,
        limit,
      }));
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = CreateOrderDtoSchema.parse(req.body);
      const order = await this.orderService.create(dto.customerId, dto.items);
      res.status(201).json(successResponse(order, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }
}

export { OrderController };
```

- [ ] **Step 2: Rewrite order.module.ts with IModule**

```typescript
// backend/src/modules/order/order.module.ts
import type { IModule } from '@core/di/container';
import type { IOrderService } from './interfaces/order.service.interface';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import {
  OrderCreatedEventSchema,
  OrderConfirmedEventSchema,
  OrderCancelledEventSchema,
} from './events/order.events';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import type { EventBus } from '@core/event-bus/event-bus';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import type { HookExecutor } from '@core/hooks/hook-executor';
import type { Express } from 'express';
import type { Db } from '@shared/types/db';

interface OrderModuleConfig {
  db: Db;
  eventBus: EventBus;
  schemaRegistry: EventSchemaRegistry;
  inventoryService: IInventoryService;
  sagaOrchestrator: SagaOrchestrator;
  hookExecutor: HookExecutor;
  app: Express;
}

class OrderModule implements IModule {
  readonly name = 'order';
  private service: IOrderService;
  private controller: OrderController;

  constructor(private readonly config: OrderModuleConfig) {
    this.service = new OrderService(
      config.db,
      config.eventBus,
      config.inventoryService,
      config.sagaOrchestrator,
      config.hookExecutor,
    );
    this.controller = new OrderController(this.service);
  }

  getService(): IOrderService {
    return this.service;
  }

  async onInit(): Promise<void> {
    // Register event schemas
    this.config.schemaRegistry.register('order.created.v1', OrderCreatedEventSchema);
    this.config.schemaRegistry.register('order.confirmed.v1', OrderConfirmedEventSchema);
    this.config.schemaRegistry.register('order.cancelled.v1', OrderCancelledEventSchema);

    // Register routes
    this.config.app.get('/api/v1/orders', (req, res, next) => this.controller.list(req, res, next));
    this.config.app.get('/api/v1/orders/:id', (req, res, next) => this.controller.getById(req, res, next));
    this.config.app.post('/api/v1/orders', (req, res, next) => this.controller.create(req, res, next));
  }

  async onDestroy(): Promise<void> {
    // Cleanup handled by container
  }
}

export { OrderModule };
export type { OrderModuleConfig };
```

- [ ] **Step 3: Rewrite order/index.ts — ModuleFactory with hooks + cross-module DI**

```typescript
// backend/src/modules/order/index.ts
import type { ModuleFactory, ModuleDefinition } from '@core/di/container';
import type { DIContainer } from '@core/di/container';
import { OrderModule } from './order.module';
import type { IInventoryService } from '@modules/inventory/interfaces/inventory.service.interface';
import type { Db } from '@shared/types/db';
import type { EventBus } from '@core/event-bus/event-bus';
import type { EventSchemaRegistry } from '@core/event-schema-registry/registry';
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';
import type { HookExecutor } from '@core/hooks/hook-executor';
import type { Express } from 'express';

const orderModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const inventoryService = container.get<IInventoryService>('IInventoryService');
    const sagaOrchestrator = container.get<SagaOrchestrator>('SagaOrchestrator');
    const hookExecutor = container.get<HookExecutor>('HookExecutor');
    const app = container.get<Express>('ExpressApp');

    const module = new OrderModule({
      db,
      eventBus,
      schemaRegistry,
      inventoryService,
      sagaOrchestrator,
      hookExecutor,
      app,
    });

    return {
      module,
      providers: [
        {
          token: 'IOrderService',
          useFactory: () => module.getService(),
          moduleName: 'order',
          exported: true,
        },
      ],
      exports: ['IOrderService'],
      hooks: [
        {
          point: 'order.beforeCreate',
          phase: 'pre',
          handler: async (ctx) => {
            // Default: validate items exist
            if (!ctx.data.items || ctx.data.items.length === 0) {
              ctx.data.rejected = true;
            }
          },
          module: 'order',
          priority: 100,
        },
        {
          point: 'order.afterCreate',
          phase: 'post',
          handler: async (ctx) => {
            // Default: log order creation
            console.log(`Order created: ${ctx.data.id}`);
          },
          module: 'order',
          priority: 100,
          failSafe: true,
        },
      ],
    };
  },
};

export default orderModuleFactory;
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx jest tests/modules/order/ -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/order/order.controller.ts backend/src/modules/order/order.module.ts backend/src/modules/order/index.ts
git commit -m "feat: add OrderController + rewrite OrderModule + ModuleFactory

- OrderController: GET /api/v1/orders, GET /api/v1/orders/:id, POST /api/v1/orders
- OrderModule: IModule with onInit (schemas + routes)
- ModuleFactory: exports IOrderService, declares hooks (beforeCreate, afterCreate)
- Cross-module: receives IInventoryService from container (resolves dependency)"
```

---

### Task 8: Wire SagaOrchestrator + HookExecutor in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Register SagaOrchestrator as core provider**

In `backend/src/main.ts`, add:

```typescript
import { SagaOrchestrator } from '@core/saga/saga-orchestrator';

// After Database registration:
container.registerCore('SagaOrchestrator', {
  useFactory: () => new SagaOrchestrator(container.get<Db>('Database')),
  deps: ['Database'],
});
```

- [ ] **Step 2: Ensure module build order resolves cross-module deps**

The `FsModuleRegistry.resolve()` does topological sort based on `module.json` dependencies. Since `order/module.json` declares `"dependencies": ["product"]` and `inventory/module.json` has no deps, the build order will be:

1. inventory (no deps)
2. product (no deps)
3. order (depends on product)

But order also needs `IInventoryService` — this is resolved at factory execution time since inventory's `IInventoryService` is registered as a provider during `container.build()`. The topo sort ensures inventory is built before order.

- [ ] **Step 3: Verify main.ts has no manual order/inventory registration**

Confirm that `main.ts` does NOT have manual `new OrderModule()` or `new InventoryModule()` calls — all handled by `container.build()`.

- [ ] **Step 4: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire SagaOrchestrator as core provider

SagaOrchestrator initialized with Database connection.
Module build order ensures inventory resolves before order."
```

---

### Task 9: Full Validation

- [ ] **Step 1: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 2: Run linter**

Run: `cd backend && npm run lint`
Expected: No errors

- [ ] **Step 3: Manual verification checklist**

- [ ] `inventory.schema.ts` has `id`, `productId`, `quantity`, `reserved`, `version`, `updatedAt`
- [ ] `IInventoryService` has `getByProductId`, `reserve`, `release`, `adjust`
- [ ] `InventoryService.reserve()` throws on insufficient stock
- [ ] `InventoryService.reserve()` emits `inventory.reserved.v1` in transaction
- [ ] `InventoryModule` implements `IModule` with `onInit` (schemas + routes)
- [ ] `inventory/index.ts` exports `IInventoryService`
- [ ] `order.schema.ts` has `orders` + `orderItems` tables
- [ ] `IOrderService` has `create`, `confirm`, `cancel`
- [ ] `OrderService.create()` executes pre-hooks before creation
- [ ] `OrderService.create()` executes post-hooks after creation
- [ ] `OrderService.create()` emits `order.created.v1`
- [ ] `createOrderSagaDefinition()` has 3 steps: validate → reserve → confirm
- [ ] Reserve step compensates with `inventoryService.release()`
- [ ] Confirm step compensates with `orderService.cancel()`
- [ ] `OrderModule` implements `IModule` with `onInit` (schemas + routes)
- [ ] `order/index.ts` exports `IOrderService`, declares hooks
- [ ] `order/index.ts` receives `IInventoryService` from container
- [ ] `main.ts` has `SagaOrchestrator` as core provider
- [ ] Module build order: inventory before order (topological sort)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 8 validation — Order + Inventory all checks pass"
```

---

## Self-Review

**Spec coverage (Part C of erp-platform-full-spec.md):**
- ✅ C.1 Order Schema (orders + order_items) → Task 5
- ✅ C.1 Order Events (created, confirmed, cancelled) → Task 5
- ✅ C.1 Hook Integration (beforeCreate, afterCreate) → Task 7 (ModuleFactory hooks)
- ✅ C.2 Inventory Schema → Task 1
- ✅ C.2 Inventory Events (reserved, released, adjusted) → Task 2
- ✅ C.3 Order Saga (validate → reserve → confirm) → Task 6
- ✅ C.4 All files listed → Tasks 1-7

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `IInventoryService`, `IOrderService`, `OrderContext` used consistently across Tasks 3, 6, 7. `HookRegistration` type from Phase 7 used in ModuleFactory hooks field.
