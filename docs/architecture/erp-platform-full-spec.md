# ERP Platform Full Implementation Spec v2.0

**Date:** 2026-04-02
**Status:** Canonical — single source of truth for Phase 6→11
**Purpose:** Complete specification for ModuleFactory, Hook System, Capability System, Capability Governance, Business Expansion, and Production Readiness

**References:**
- `Architecture-v2.2.md` — ADR-001→ADR-009, §16 Hook System, §17 Queue Boundary
- `Extended-Architecture-v2.2.md` — Soft Restart & Optional Module
- `extended-architecture-implementation-spec.md` — Phase 0→5 (assumed complete)
- `ERP-Development-Roadmap.md` v2.0 — Phase overview

**Assumed State:** Phase 0→5 complete. System has: ResettableContainer, FsModuleRegistry, IModule lifecycle, TrafficGate, SoftRestartManager, ModuleInstaller, BullMQ QueueManager, metrics endpoint.

---

# Part A: Phase 6 — ModuleFactory + Module Contracts

## A.1 Problem Statement

Current module registration is manual in `main.ts`. Modules don't declare their providers, exports, or contracts. Phase 6 standardizes module entry through ModuleFactory.

## A.2 Interfaces

```typescript
// core/module-factory/types.ts

interface ModuleFactory {
  create(container: DIContainer): Promise<ModuleDefinition>;
}

interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];           // Public service contract tokens (e.g., 'IProductService')
  hooks?: HookRegistration[];   // Pre-registered hooks (Phase 7 dependency)
}

// Extend existing ProviderRegistration with export tracking
interface ProviderRegistration<T = unknown> {
  token: string;
  useClass?: new (...args: unknown[]) => T;
  useFactory?: (container: DIContainer) => Promise<T> | T;
  deps?: string[];
  scope?: 'singleton' | 'transient';
  moduleName?: string;          // Set by container during build
  exported?: boolean;           // True if part of module's public contract
}
```

## A.3 Module Contract Rules

1. **Export enforcement:** Module MUST export at least one service interface token
2. **Naming convention:** Exported tokens MUST start with `I` (e.g., `IProductService`)
3. **Access control:** Other modules can ONLY access exported tokens via DI
4. **No direct imports:** Cross-module `import { X } from '../other-module'` forbidden (ESLint rule)

## A.4 ModuleFactory Example

```typescript
// modules/product/index.ts

const productModuleFactory: ModuleFactory = {
  async create(container: DIContainer): Promise<ModuleDefinition> {
    const db = container.get<Db>('Database');
    const eventBus = container.get<EventBus>('EventBus');
    const schemaRegistry = container.get<EventSchemaRegistry>('EventSchemaRegistry');
    const eventConsumer = container.get<EventConsumer>('EventConsumer');
    const cacheService = container.get<CacheService>('CacheService');
    const app = container.get<Express>('ExpressApp');

    const productRepository = new ProductRepository(db);
    const productService = new ProductService(productRepository, eventBus);
    const productController = new ProductController(productService);

    return {
      module: new ProductModule({
        service: productService,
        controller: productController,
        schemaRegistry,
        eventConsumer,
        cacheService,
        app,
      }),
      providers: [
        { token: 'ProductRepository', useFactory: () => productRepository, moduleName: 'product' },
        { token: 'IProductService', useFactory: () => productService, moduleName: 'product', exported: true },
      ],
      exports: ['IProductService'],
    };
  },
};

export default productModuleFactory;
```

## A.5 Container Integration

```typescript
// In container.build() — Step 2 update:

for (const metadata of enabledModules) {
  const factory = await metadata.entry();
  const def = await factory.create(this);

  // Register providers
  for (const provider of def.providers) {
    provider.moduleName = metadata.name;
    this.moduleProviders.set(provider.token, provider);
  }

  // Track exports
  if (def.exports) {
    for (const token of def.exports) {
      this.exportedTokens.set(token, metadata.name);
    }
  }

  // Store hooks for Phase 7
  if (def.hooks) {
    this.pendingHooks.push(...def.hooks);
  }

  this.modules.push(def.module);
}
```

## A.6 Contract Validator (Build-Time)

```typescript
// core/module-factory/contract-validator.ts

function validateModuleDefinition(def: ModuleDefinition, moduleName: string): void {
  // Must export at least one token
  if (!def.exports || def.exports.length === 0) {
    throw new Error(`Module "${moduleName}" must export at least one service interface`);
  }

  // Exported tokens must exist in providers
  for (const token of def.exports) {
    if (!def.providers.some(p => p.token === token)) {
      throw new Error(`Module "${moduleName}" exports "${token}" but no provider registered`);
    }
  }

  // Exported tokens must follow naming convention
  for (const token of def.exports) {
    if (!token.startsWith('I')) {
      throw new Error(`Exported token "${token}" in module "${moduleName}" must start with 'I'`);
    }
  }
}
```

## A.7 Files

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/core/module-factory/types.ts` | Create | Interface definitions |
| `backend/src/core/module-factory/contract-validator.ts` | Create | Build-time validation |
| `backend/src/modules/product/index.ts` | Modify | Convert to ModuleFactory |
| `backend/src/modules/order/index.ts` | Modify | Convert to ModuleFactory |
| `backend/src/core/di/container.ts` | Modify | Track exports, store pending hooks |

---

# Part B: Phase 7 — Hook System

## B.1 Architecture Reference

Per Architecture v2.2 §16 (Lines 1973–2040). This spec implements the full hook system with conflict detection.

## B.2 Interfaces

```typescript
// core/hooks/types.ts

interface HookPoint {
  name: string;              // "order.beforeCreate"
  phase: 'pre' | 'post';
  timeout?: number;          // default: 5000ms
  failSafe?: boolean;        // default: true (continue on failure)
}

interface HookHandler {
  plugin?: string;
  module?: string;
  priority?: number;         // lower = runs first, default: 100
  handler: (context: HookContext) => Promise<void>;
}

interface HookContext {
  data: any;
  result?: any;
  stopPropagation?: boolean;
  metadata: {
    point: string;
    phase: 'pre' | 'post';
    executionId: string;
  };
}

interface HookRegistration {
  point: string;             // "order.beforeCreate"
  phase: 'pre' | 'post';
  handler: (ctx: HookContext) => Promise<void>;
  plugin?: string;
  module?: string;
  priority?: number;
  timeout?: number;
  failSafe?: boolean;
}
```

## B.3 HookRegistry

```typescript
// core/hooks/hook-registry.ts

class HookRegistry {
  private points = new Map<string, HookPoint>();
  private hooks = new Map<string, HookRegistration[]>();

  registerPoint(point: HookPoint): void {
    this.points.set(point.name, point);
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

  clearByModule(moduleName: string): void {
    for (const [key, hooks] of this.hooks) {
      this.hooks.set(key, hooks.filter(h => h.module !== moduleName));
    }
  }

  clearByPlugin(pluginName: string): void {
    for (const [key, hooks] of this.hooks) {
      this.hooks.set(key, hooks.filter(h => h.plugin !== pluginName));
    }
  }

  clear(): void {
    this.hooks.clear();
  }
}
```

## B.4 HookExecutor

```typescript
// core/hooks/hook-executor.ts

class HookExecutor {
  constructor(
    private registry: HookRegistry,
    private logger: Logger,
  ) {}

  async execute(pointName: string, phase: 'pre' | 'post', data: any): Promise<HookContext> {
    const point = this.registry.getPoint(pointName);
    const hooks = this.registry.getHooks(pointName, phase);

    const sorted = [...hooks].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const ctx: HookContext = {
      data,
      result: undefined,
      stopPropagation: false,
      metadata: {
        point: pointName,
        phase,
        executionId: randomUUID(),
      },
    };

    for (const hook of sorted) {
      const timeout = hook.timeout ?? point?.timeout ?? 5000;
      const failSafe = hook.failSafe ?? point?.failSafe ?? true;

      try {
        await Promise.race([
          hook.handler(ctx),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Hook timeout: ${hook.point} after ${timeout}ms`)), timeout),
          ),
        ]);

        if (ctx.stopPropagation) break;
      } catch (err) {
        this.logger.error(
          { err, point: pointName, phase, plugin: hook.plugin, module: hook.module },
          'Hook execution failed',
        );
        if (!failSafe) {
          throw err;
        }
      }
    }

    return ctx;
  }
}
```

## B.5 Integration with Container

```typescript
// In container.build() — after module.onInit():

// Register hooks from ModuleDefinition
for (const hook of this.pendingHooks) {
  this.hookRegistry.register(hook);
}
this.pendingHooks = [];
```

```typescript
// In container.dispose() — before module.onDestroy():

// Clear hooks by module name
for (const mod of this.modules) {
  this.hookRegistry.clearByModule(mod.name);
}
```

## B.6 Usage in Business Logic

```typescript
// In OrderService.create():

async create(orderData: CreateOrderDto): Promise<Order> {
  // Pre-hooks
  const preCtx = await this.hookExecutor.execute('order.beforeCreate', 'pre', orderData);
  if (preCtx.data.rejected) {
    throw new Error('Order rejected by hook');
  }

  // Business logic
  const order = await this.orderRepository.create(preCtx.data);

  // Post-hooks (fire-and-forget, fail-safe)
  await this.hookExecutor.execute('order.afterCreate', 'post', order);

  return order;
}
```

## B.7 Conflict Detection (Build-Time)

```typescript
// core/hooks/conflict-detector.ts

function detectHookConflicts(hooks: HookRegistration[]): void {
  const byPoint = new Map<string, HookRegistration[]>();

  for (const hook of hooks) {
    const key = `${hook.point}:${hook.phase}`;
    const list = byPoint.get(key) ?? [];
    list.push(hook);
    byPoint.set(key, list);
  }

  for (const [key, registrations] of byPoint) {
    // Check for duplicate plugin/module registrations
    const sources = registrations.map(r => r.plugin ?? r.module ?? 'unknown');
    const duplicates = sources.filter((s, i) => sources.indexOf(s) !== i);
    if (duplicates.length > 0) {
      throw new Error(`Duplicate hook registration: ${duplicates.join(', ')} on ${key}`);
    }
  }
}
```

## B.8 Files

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/core/hooks/types.ts` | Create | Interface definitions |
| `backend/src/core/hooks/hook-registry.ts` | Create | Hook storage + lookup |
| `backend/src/core/hooks/hook-executor.ts` | Create | Execution engine |
| `backend/src/core/hooks/conflict-detector.ts` | Create | Build-time validation |
| `backend/tests/core/hooks/hook-registry.test.ts` | Create | Registry tests |
| `backend/tests/core/hooks/hook-executor.test.ts` | Create | Executor tests |

---

# Part C: Phase 8 — Business Expansion (Order + Inventory)

## C.1 Order Module

### Schema

```typescript
// modules/order/order.schema.ts

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderNumber: varchar('order_number', { length: 50 }).notNull().unique(),
  customerId: uuid('customer_id').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  productId: uuid('product_id').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
});
```

### Events

| Event | Trigger |
|-------|---------|
| `order.created.v1` | Order created (pending) |
| `order.confirmed.v1` | Saga completed successfully |
| `order.cancelled.v1` | Saga failed or user cancelled |

### Hook Integration

```typescript
// In order factory:
hooks: [
  {
    point: 'order.beforeCreate',
    phase: 'pre',
    handler: validateVoucherHook,
    module: 'order',
    priority: 100,
  },
  {
    point: 'order.afterCreate',
    phase: 'post',
    handler: sendNotificationHook,
    module: 'order',
    priority: 100,
  },
]
```

## C.2 Inventory Module

### Schema

```typescript
// modules/inventory/inventory.schema.ts

export const inventory = pgTable('inventory', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').notNull().unique(),
  quantity: integer('quantity').notNull().default(0),
  reserved: integer('reserved').notNull().default(0),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### Events

| Event | Trigger |
|-------|---------|
| `inventory.reserved.v1` | Stock reserved for order |
| `inventory.released.v1` | Reservation released (order cancelled) |
| `inventory.adjusted.v1` | Manual stock adjustment |

## C.3 Order Saga

```typescript
// modules/order/sagas/create-order.saga.ts

const createOrderSaga: SagaDefinition<OrderContext> = {
  name: 'create-order',
  aggregateId: '',  // Set per execution
  maxRetries: 3,
  retryDelayMs: 60_000,
  steps: [
    {
      name: 'reserveInventory',
      execute: (ctx) => inventoryService.reserve(ctx.orderId, ctx.items),
      compensate: (ctx) => inventoryService.release(ctx.orderId),
      timeout: 10_000,
      retry: { maxAttempts: 2, backoffMs: 1000, retryableErrors: ['STOCK_INSUFFICIENT'] },
    },
    {
      name: 'calculateTotal',
      execute: (ctx) => pricingCapability.execute('pricing', { input: ctx.items }),
      compensate: async () => {},
      timeout: 5_000,
      retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
    },
    {
      name: 'confirmOrder',
      execute: (ctx) => orderService.confirm(ctx.orderId),
      compensate: (ctx) => orderService.cancel(ctx.orderId),
      timeout: 5_000,
      retry: { maxAttempts: 1, backoffMs: 0, retryableErrors: [] },
    },
  ],
};
```

## C.4 Files

| File | Action |
|------|--------|
| `backend/src/modules/order/order.schema.ts` | Create/Modify |
| `backend/src/modules/order/order.service.ts` | Create/Modify |
| `backend/src/modules/order/order.controller.ts` | Create |
| `backend/src/modules/order/sagas/create-order.saga.ts` | Create |
| `backend/src/modules/inventory/module.json` | Create |
| `backend/src/modules/inventory/index.ts` | Create |
| `backend/src/modules/inventory/inventory.module.ts` | Create |
| `backend/src/modules/inventory/inventory.schema.ts` | Create |
| `backend/src/modules/inventory/inventory.service.ts` | Create |
| `backend/src/modules/inventory/inventory.controller.ts` | Create |

---

# Part D: Phase 9 — Capability System

## D.1 Capability Types

```typescript
// core/capability/types.ts

interface Capability {
  name: string;              // "pricing"
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];         // For pipeline: ['base', 'discount', 'tax', 'rounding', 'final']
}

interface CapabilityHandler {
  capability: string;        // "pricing"
  stage?: string;            // "discount" (required for pipeline)
  priority?: number;
  exclusive?: boolean;       // Only one handler per capability (single type)
  condition?: (ctx: CapabilityContext) => boolean;
  plugin?: string;
  module?: string;
  handle(ctx: CapabilityContext): Promise<void>;
}

interface CapabilityContext {
  input: any;
  state: Record<string, any>;
  result?: any;
  stop?: boolean;
}
```

## D.2 CapabilityRegistry

```typescript
// core/capability/capability-registry.ts

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

    // Validate stage for pipeline
    if (cap.type === 'pipeline' && handler.stage && cap.stages && !cap.stages.includes(handler.stage)) {
      throw new Error(`Invalid stage "${handler.stage}" for capability "${cap.name}". Valid: ${cap.stages.join(', ')}`);
    }

    const list = this.handlers.get(handler.capability) ?? [];
    list.push(handler);
    this.handlers.set(handler.capability, list);
  }

  getHandlers(name: string): CapabilityHandler[] {
    return this.handlers.get(name) ?? [];
  }

  getCapability(name: string): Capability | undefined {
    return this.capabilities.get(name);
  }

  clearByModule(moduleName: string): void {
    for (const [key, handlers] of this.handlers) {
      this.handlers.set(key, handlers.filter(h => h.module !== moduleName));
    }
  }

  clear(): void {
    this.capabilities.clear();
    this.handlers.clear();
  }
}
```

## D.3 CapabilityExecutor

```typescript
// core/capability/capability-executor.ts

class CapabilityExecutor {
  constructor(
    private registry: CapabilityRegistry,
    private logger: Logger,
  ) {}

  async execute(name: string, input: any): Promise<any> {
    const cap = this.registry.getCapability(name);
    if (!cap) throw new Error(`Capability "${name}" not found`);

    const ctx: CapabilityContext = { input, state: {}, result: undefined, stop: false };

    switch (cap.type) {
      case 'pipeline':
        return this.executePipeline(name, cap, ctx);
      case 'single':
        return this.executeSingle(name, ctx);
      case 'composable':
        return this.executeComposable(name, ctx);
    }
  }

  private async executePipeline(name: string, cap: Capability, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);

    // Sort by stage order (based on cap.stages) then priority
    const stageOrder = cap.stages ?? [];
    const sorted = [...handlers].sort((a, b) => {
      const aIdx = stageOrder.indexOf(a.stage ?? '');
      const bIdx = stageOrder.indexOf(b.stage ?? '');
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.priority ?? 100) - (b.priority ?? 100);
    });

    for (const handler of sorted) {
      if (handler.condition && !handler.condition(ctx)) continue;
      await handler.handle(ctx);
      if (ctx.stop) break;
    }

    return ctx.result;
  }

  private async executeSingle(name: string, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);
    if (handlers.length > 1) {
      throw new Error(`Capability "${name}" is single-type but has ${handlers.length} handlers`);
    }
    if (handlers.length === 0) {
      throw new Error(`No handler registered for capability "${name}"`);
    }
    await handlers[0].handle(ctx);
    return ctx.result;
  }

  private async executeComposable(name: string, ctx: CapabilityContext): Promise<any> {
    const handlers = this.registry.getHandlers(name);
    await Promise.all(handlers.map(h => h.handle(ctx)));
    return ctx.result;
  }
}
```

## D.4 Build-Time Validation

```typescript
// core/capability/conflict-detector.ts

function validateCapabilities(registry: CapabilityRegistry): void {
  for (const [name, cap] of registry['capabilities']) {
    const handlers = registry.getHandlers(name);

    // Single type: exactly one handler
    if (cap.type === 'single' && handlers.length > 1) {
      throw new Error(`Capability "${name}" is single-type but has ${handlers.length} handlers`);
    }

    // Exclusive check
    const exclusive = handlers.filter(h => h.exclusive);
    if (exclusive.length > 1) {
      throw new Error(`Capability "${name}" has multiple exclusive handlers`);
    }

    // Pipeline stage validation
    if (cap.type === 'pipeline' && cap.stages) {
      for (const h of handlers) {
        if (h.stage && !cap.stages.includes(h.stage)) {
          throw new Error(`Invalid stage "${h.stage}" for capability "${name}"`);
        }
      }
    }
  }
}
```

## D.5 Pricing Pipeline Example

```typescript
// modules/product/capabilities/pricing.capability.ts

const pricingCapability: Capability = {
  name: 'pricing',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
};

// Base price handler (product module)
const basePriceHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'base',
  priority: 10,
  module: 'product',
  handle: async (ctx) => {
    ctx.state.basePrice = ctx.input.basePrice;
    ctx.result = ctx.input.basePrice;
  },
};

// Discount handler (voucher plugin)
const discountHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'discount',
  priority: 50,
  plugin: 'voucher',
  handle: async (ctx) => {
    const discount = await calculateDiscount(ctx.input);
    ctx.result = ctx.result * (1 - discount);
    ctx.state.discount = discount;
  },
};

// Tax handler
const taxHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'tax',
  priority: 50,
  module: 'product',
  handle: async (ctx) => {
    const taxRate = 0.1; // 10%
    ctx.result = ctx.result * (1 + taxRate);
    ctx.state.taxRate = taxRate;
  },
};
```

## D.6 Files

| File | Action |
|------|--------|
| `backend/src/core/capability/types.ts` | Create |
| `backend/src/core/capability/capability-registry.ts` | Create |
| `backend/src/core/capability/capability-executor.ts` | Create |
| `backend/src/core/capability/conflict-detector.ts` | Create |
| `backend/tests/core/capability/capability-registry.test.ts` | Create |
| `backend/tests/core/capability/capability-executor.test.ts` | Create |
| `backend/src/modules/product/capabilities/pricing.capability.ts` | Create |

---

# Part E: Phase 10 — Capability Governance

## E.1 Capability Contract (Versioned)

```typescript
// core/capability-governance/types.ts

interface CapabilityContract {
  name: string;              // "pricing"
  version: string;           // semver: "1.2.0"
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
  inputSchema?: ZodSchema;
  outputSchema?: ZodSchema;
  compatibility: {
    backwardCompatible: boolean;
  };
  deprecated?: boolean;
  sunsetDate?: string;       // ISO date
}
```

## E.2 Capability Requirement

```typescript
interface CapabilityRequirement {
  name: string;              // "pricing"
  versionRange: string;      // "^1.1.0"
  mode: 'required' | 'optional';
}
```

## E.3 Handler with Version Support

```typescript
interface VersionedCapabilityHandler extends CapabilityHandler {
  supportedVersion: string;  // "1.2.x" — semver range
}
```

## E.4 Version Resolution

```typescript
// core/capability-governance/version-resolver.ts

import satisfies from 'semver/functions/satisfies';

function resolveHandlerCompatibility(
  contract: CapabilityContract,
  handler: VersionedCapabilityHandler,
): void {
  if (!satisfies(contract.version, handler.supportedVersion)) {
    if (contract.compatibility.backwardCompatible) {
      // Old handler on new contract — OK if backward-compatible
      return;
    }
    throw new Error(
      `Handler ${handler.plugin ?? handler.module} incompatible with ` +
      `${contract.name}@${contract.version} (supports ${handler.supportedVersion})`,
    );
  }
}

function validateRequirements(
  requirements: CapabilityRequirement[],
  registry: CapabilityGovernanceRegistry,
): void {
  for (const req of requirements) {
    const contract = registry.getContract(req.name);
    if (!contract) {
      if (req.mode === 'optional') continue;
      throw new Error(`Missing required capability: ${req.name}`);
    }
    if (!satisfies(contract.version, req.versionRange)) {
      throw new Error(
        `Capability ${req.name}@${contract.version} does not satisfy ${req.versionRange}`,
      );
    }
    if (contract.deprecated) {
      console.warn(`Capability "${req.name}" is deprecated${contract.sunsetDate ? `, sunset: ${contract.sunsetDate}` : ''}`);
    }
    if (contract.sunsetDate && new Date() > new Date(contract.sunsetDate)) {
      throw new Error(`Capability "${req.name}" has passed sunset date: ${contract.sunsetDate}`);
    }
  }
}
```

## E.5 CapabilityGovernanceRegistry

```typescript
// core/capability-governance/governance-registry.ts

class CapabilityGovernanceRegistry extends CapabilityRegistry {
  private contracts = new Map<string, CapabilityContract>();

  registerContract(contract: CapabilityContract): void {
    this.contracts.set(contract.name, contract);
    // Also register as capability
    this.registerCapability({
      name: contract.name,
      type: contract.type,
      stages: contract.stages,
    });
  }

  getContract(name: string): CapabilityContract | undefined {
    return this.contracts.get(name);
  }

  registerVersionedHandler(handler: VersionedCapabilityHandler): void {
    const contract = this.contracts.get(handler.capability);
    if (contract) {
      resolveHandlerCompatibility(contract, handler);
    }
    this.registerHandler(handler);
  }
}
```

## E.6 Conflict Matrix

| Conflict | Detection | Resolution |
|----------|-----------|------------|
| Version mismatch | build-time | fail |
| Multiple exclusive | build-time | fail |
| Invalid stage | build-time | fail |
| Ordering conflict | topo sort | resolve |
| Priority conflict | priority sort | resolve |
| Deprecation warning | build-time | warn |
| Post-sunset | build-time | fail |

## E.7 ModuleFactory Integration

```typescript
interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];
  hooks?: HookRegistration[];
  capabilities?: CapabilityHandler[];     // NEW
  requires?: CapabilityRequirement[];     // NEW
}
```

## E.8 Container Build Flow (Updated)

```
1. Load modules (filesystem scan)
2. Register capability contracts
3. Create ModuleDefinitions (factory.create())
4. Validate module contracts (exports, naming)
5. Register providers
6. Track exports
7. Register hooks
8. Register capability handlers (with version check)
9. Validate requirements (all modules)
10. Detect hook conflicts
11. Detect capability conflicts
12. Validate DI graph
13. Instantiate singletons
14. Call module.onInit()
15. Ready
```

## E.9 Observability

```typescript
// Metrics
capability_conflict_total
capability_version_mismatch_total
capability_execution_latency_seconds
capability_handler_invoked_total
```

## E.10 Dependency

```json
{
  "dependencies": {
    "semver": "^7.6.0"
  },
  "devDependencies": {
    "@types/semver": "^7.5.0"
  }
}
```

## E.11 Files

| File | Action |
|------|--------|
| `backend/src/core/capability-governance/types.ts` | Create |
| `backend/src/core/capability-governance/governance-registry.ts` | Create |
| `backend/src/core/capability-governance/version-resolver.ts` | Create |
| `backend/src/core/capability-governance/contract-validator.ts` | Create |
| `backend/tests/core/capability-governance/version-resolver.test.ts` | Create |
| `backend/tests/core/capability-governance/governance-registry.test.ts` | Create |
| `backend/package.json` | Modify — add semver |

---

# Part F: Phase 11 — Production Readiness

## F.1 CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
      redis:
        image: redis:7
        ports: ['6379:6379']
      rabbitmq:
        image: rabbitmq:3-management
        ports: ['5672:5672']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: cd backend && npm ci
      - run: cd backend && npm run lint
      - run: cd backend && npm run lint:spec
      - run: cd backend && npm run test:coverage
      - run: cd backend && npm run lint:migration
```

## F.2 Docker

```dockerfile
# backend/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --production=false
COPY backend/ ./
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

## F.3 Monitoring

### Prometheus Alerts

```yaml
groups:
  - name: erp-alerts
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 2m
      - alert: RestartFailed
        expr: system_restart_failed_total > 0
        for: 1m
      - alert: CircuitBreakerOpen
        expr: circuit_breaker_state == 2
        for: 5m
```

### Grafana Dashboards

- System overview (uptime, request rate, error rate)
- Module status (active modules, restart count)
- Event pipeline (outbox pending, consumer lag, DLQ size)
- Capability execution (latency p50/p99 per capability)

## F.4 Load Testing

```javascript
// k6/load-test.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 100,
  duration: '5m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get('http://localhost:3000/api/v1/products');
  check(res, { 'status 200': (r) => r.status === 200 });
}
```

## F.5 Deployment

- Blue/Green per Architecture v2.2 §32.5
- Automated rollback on health check failure (3 consecutive 503)
- Migration runs before deployment (backward-compatible, ADR-009 enforced)

## F.6 Files

| File | Action |
|------|--------|
| `.github/workflows/ci.yml` | Create |
| `backend/Dockerfile` | Create |
| `docker-compose.yml` | Modify |
| `monitoring/prometheus/alerts.yml` | Create |
| `monitoring/grafana/dashboards/` | Create directory |
| `k6/load-test.js` | Create |

---

# Appendix: Complete File Map (Phase 6→11)

## Phase 6 — ModuleFactory

| File | Action |
|------|--------|
| `backend/src/core/module-factory/types.ts` | Create |
| `backend/src/core/module-factory/contract-validator.ts` | Create |
| `backend/src/modules/product/index.ts` | Modify |
| `backend/src/modules/order/index.ts` | Modify |
| `backend/src/core/di/container.ts` | Modify |

## Phase 7 — Hook System

| File | Action |
|------|--------|
| `backend/src/core/hooks/types.ts` | Create |
| `backend/src/core/hooks/hook-registry.ts` | Create |
| `backend/src/core/hooks/hook-executor.ts` | Create |
| `backend/src/core/hooks/conflict-detector.ts` | Create |
| `backend/tests/core/hooks/hook-registry.test.ts` | Create |
| `backend/tests/core/hooks/hook-executor.test.ts` | Create |

## Phase 8 — Business Expansion

| File | Action |
|------|--------|
| `backend/src/modules/order/order.schema.ts` | Create/Modify |
| `backend/src/modules/order/order.service.ts` | Create/Modify |
| `backend/src/modules/order/order.controller.ts` | Create |
| `backend/src/modules/order/sagas/create-order.saga.ts` | Create |
| `backend/src/modules/inventory/module.json` | Create |
| `backend/src/modules/inventory/index.ts` | Create |
| `backend/src/modules/inventory/inventory.module.ts` | Create |
| `backend/src/modules/inventory/inventory.schema.ts` | Create |
| `backend/src/modules/inventory/inventory.service.ts` | Create |
| `backend/src/modules/inventory/inventory.controller.ts` | Create |

## Phase 9 — Capability System

| File | Action |
|------|--------|
| `backend/src/core/capability/types.ts` | Create |
| `backend/src/core/capability/capability-registry.ts` | Create |
| `backend/src/core/capability/capability-executor.ts` | Create |
| `backend/src/core/capability/conflict-detector.ts` | Create |
| `backend/tests/core/capability/capability-registry.test.ts` | Create |
| `backend/tests/core/capability/capability-executor.test.ts` | Create |
| `backend/src/modules/product/capabilities/pricing.capability.ts` | Create |

## Phase 10 — Capability Governance

| File | Action |
|------|--------|
| `backend/src/core/capability-governance/types.ts` | Create |
| `backend/src/core/capability-governance/governance-registry.ts` | Create |
| `backend/src/core/capability-governance/version-resolver.ts` | Create |
| `backend/src/core/capability-governance/contract-validator.ts` | Create |
| `backend/tests/core/capability-governance/version-resolver.test.ts` | Create |
| `backend/tests/core/capability-governance/governance-registry.test.ts` | Create |
| `backend/package.json` | Modify — add semver |

## Phase 11 — Production Readiness

| File | Action |
|------|--------|
| `.github/workflows/ci.yml` | Create |
| `backend/Dockerfile` | Create |
| `docker-compose.yml` | Modify |
| `monitoring/prometheus/alerts.yml` | Create |
| `monitoring/grafana/dashboards/` | Create |
| `k6/load-test.js` | Create |

---

# Validation Gates (Per Phase)

Every phase must pass ALL gates:

| Gate | Command |
|------|---------|
| Lint | `npm run lint` |
| Test | `npm test` |
| Coverage | `npm run test:coverage` (≥80%) |
| Spec lint | `npm run lint:spec` |
| TDD evidence | RED→GREEN per behavior |

---

# END
