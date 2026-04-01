# PROJECT STANDARD — ERP Backend

**Version:** 1.0  
**Date:** 2026-04-01  
**Canonical Reference:** docs/architecture-v2.2.md

---

## §1 Architecture

### Monorepo Structure

```
backend/
├── src/
│   ├── core/          # Kernel: DI, EventBus, Config, PluginLoader, Saga
│   ├── modules/       # Domain modules: product, order, inventory, etc.
│   ├── plugins/       # Extension plugins: analytics, reporting, etc.
│   └── shared/        # Shared types, utils, interfaces
├── database/
│   └── migrations/    # drizzle-kit generated migrations
├── config/            # Plugin config, feature flags
├── scripts/           # Dev scripts (start, migrate, seed)
└── tests/             # Integration + e2e tests
```

### Layer Rules

| Layer | Can Import From | Cannot Import From |
|-------|----------------|-------------------|
| core | shared | modules, plugins |
| modules | core (interfaces only), shared | other modules, plugins |
| plugins | core (interfaces only), shared (service interfaces) | modules (internals), repositories |
| shared | nothing (leaf) | — |

### Communication

- Module ↔ Module: Service interfaces + Events
- Plugin → Module: Service interface ONLY
- Plugin → DB: NEVER (use service interface)

---

## §2 Backend Standards

### Module Structure

```
src/modules/{module-name}/
├── {module-name}.module.ts      # Module registration
├── {module-name}.service.ts     # Business logic
├── {module-name}.controller.ts  # HTTP endpoints
├── {module-name}.schema.ts      # Drizzle pgTable definition
├── dto/
│   ├── create-{name}.dto.ts
│   └── update-{name}.dto.ts
├── events/
│   └── {module-name}.events.ts  # Event schemas + types
└── interfaces/
    └── {module-name}.service.interface.ts
```

### Schema Rules (Drizzle)

- TypeScript property `camelCase` → DB column `snake_case` (explicit mapping)
- Schema file = source of truth for queries AND migrations
- ALL column names MUST be explicitly mapped in `pgTable()`

### Service Pattern

- Constructor injection via DI container
- No try/catch for normal operations — only for transactions and best-effort
- Return typed results, never `null` without explicit nullable type

### Controller Pattern

- Thin controllers — delegate to service
- Return raw service results — naming conversion handled by interceptor
- Use DTO classes for request validation

---

## §3 Frontend Standards

*(Not applicable to backend skeleton — will be defined when frontend is built)*

---

## §4 Shared Packages

### @erp/dto

Shared TypeScript types/interfaces used across modules:

- Event schemas (EventEnvelope)
- Service interfaces (IProductService, etc.)
- Common types (PaginatedResult, ApiResponse, etc.)

Location: `src/shared/`

### @erp/ui

*(Frontend package — not applicable to backend skeleton)*

---

## §5 API Standards

### OpenAPI Spec-First

1. Define/update `specs/openapi.yaml` FIRST
2. Validate: `npm run lint:spec`
3. Implement backend to match spec
4. Generate frontend types: `cd apps/shop && npm run generate:types`

### Endpoint Conventions

- URL versioning: `/api/v1/`
- REST resources: `/api/v1/products`, `/api/v1/orders`
- snake_case in API contracts (OpenAPI spec, request/response)
- camelCase in TypeScript code (services, DTOs, controllers)

### Response Format

```typescript
// Success
{ data: T, meta: { timestamp, version, request_id, pagination? } }

// Error
{ error: { code, message, details?, trace_id } }
```

---

## §6 Event-Driven

### EventEnvelope

```typescript
interface EventEnvelope<T = unknown> {
  id: string;                    // UUID v4
  type: string;                  // "{module}.{action}.v{version}"
  source: string;                // service name
  timestamp: string;             // ISO8601
  aggregate_id: string;          // REQUIRED, top-level (ADR-002)
  payload: T;
  metadata: {
    version: string;             // "v1", "v2"
    correlation_id?: string;
    causation_id?: string;
  };
}
```

### Transport: RabbitMQ

- Exchange: `erp.events` (topic)
- Routing key = event type
- Queue per consumer group
- Prefetch = 1 per consumer (sequential per aggregate)

### Naming: `{module}.{action}.v{version}`

Examples: `product.created.v1`, `order.confirmed.v1`

### Transaction Rule (ADR-005)

- `EventBus.emit(event, tx)` — tx is REQUIRED
- Outbox write in SAME transaction as domain data
- NEVER emit event outside transaction

### Schema Validation (ADR-008)

- All events validated against registered schema BEFORE publish
- All events validated AFTER receive
- Event not registered → emit throws error

---

## §7 Testing

### Framework

- Jest for unit + integration tests
- Playwright for e2e (future)

### Coverage

- Minimum: 80% code coverage
- Each behavior = 1 TDD cycle (RED → GREEN → REFACTOR)

### TDD Rules

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

### Mock Patterns

- Mock external services (RabbitMQ, Redis) in unit tests
- Use real DB for integration tests (test database)
- Mock time-dependent code (Date.now, setTimeout)

---

## §8 Linting

### ESLint

- TypeScript strict mode
- Architecture rules enforced (see §Architecture Enforcement)
- No `any` without explicit `// eslint-disable-next-line` comment

### Prettier

- Single quotes
- Trailing commas (all)
- 100 print width
- 2-space indentation

### TypeScript

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- Path aliases: `@core/*`, `@modules/*`, `@plugins/*`, `@shared/*`

---

## §9 Git & CI/CD

### Branch Naming

- Feature: `feat/{module}/{description}`
- Fix: `fix/{module}/{description}`
- Plugin: `plugin/{name}/{description}`

### Conventional Commits

```
type(scope): description

Examples:
feat(product): add variant support
fix(order): correct tax calculation
refactor(core): extract event bus interface
```

### CI Pipeline

```
1. npm run lint           (ESLint + architecture rules)
2. npm run typecheck      (TypeScript strict)
3. npm run test           (unit + integration)
4. npm run lint:spec      (OpenAPI validation)
5. npm run lint:migration (Migration linter, ADR-009)
```

---

## §10 Security

### Auth

- JWT RS256 (asymmetric)
- Access token: 15 min TTL
- Refresh token: 7 days, with rotation
- Token revocation via Redis blacklist

### RBAC

- Role-based access control (Phase 1)
- `@Roles('admin', 'manager')` decorator
- `@Permissions('product:write')` decorator

### Rate Limiting

- Redis-backed sliding window
- Per-user: 100 req/min
- Per-IP: 60 req/min
- Custom per endpoint (e.g., auth: 5 req/min)

### Plugin Security (Phase 1)

- TRUSTED plugins ONLY
- `trusted: boolean` in metadata
- Permission manifest validated at activation

---

## §11 Coding Standards

### §11.1 Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| TypeScript code | `camelCase` | `cartId`, `paymentMethod` |
| PostgreSQL columns | `snake_case` | `cart_id`, `payment_method` |
| API contract (OpenAPI) | `snake_case` | `cart_id`, `payment_method` |
| Drizzle pgTable | `camelCase` property → `snake_case` column | `basePrice: decimal('base_price')` |
| Class names | `PascalCase` | `ProductService`, `EventBus` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_ATTEMPTS`, `DEFAULT_TTL` |
| Files | `kebab-case` | `product.service.ts`, `create-product.dto.ts` |

### §11.2 Import Ordering

```typescript
// 1. Node.js built-ins
import { randomUUID } from 'node:crypto';

// 2. External packages (alphabetical)
import { eq, and } from 'drizzle-orm';
import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core';
import { z } from 'zod';

// 3. Core imports (absolute paths)
import { EventBus } from '@core/event-bus';
import { Config } from '@core/config';

// 4. Module imports (absolute paths)
import { ProductSchema } from '@modules/product/product.schema';

// 5. Shared imports
import { EventEnvelope } from '@shared/types/event';

// 6. Relative imports (same module)
import { CreateProductDto } from './dto/create-product.dto';
```

### §11.3 TypeScript Conventions

- Use `interface` for object shapes, `type` for unions/intersections
- Prefer `readonly` for immutable properties
- Use `enum` only for finite sets (ErrorCode, SagaStatus)
- Use discriminated unions for event types
- Never use `!` non-null assertion — handle null explicitly

### §11.4 Async Patterns

- All async functions return `Promise<T>`
- Use `Promise.allSettled()` for parallel independent operations
- Use `Promise.all()` only when ALL must succeed
- No try/catch for normal service operations
- try/catch ONLY for:
  - Transaction boundaries
  - Best-effort operations (logging, notifications)
  - External service calls

### §11.5 Null Handling

- Use `undefined` (not `null`) for optional values
- Use `Result<T, E>` pattern for operations that can fail
- Never use `!` non-null assertion
- Use `?.` optional chaining for potentially null access
- Use explicit null checks for business logic branching

### §11.6 Constants

- No magic numbers — extract to named constants
- Group related constants in `constants.ts` files
- Use `as const` for literal type inference

```typescript
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_TTL_SECONDS = 86400;
const SAGA_CLEANUP_BATCH_SIZE = 100;
```

### §11.7 Error Handling

```typescript
class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: object,
    public readonly retryable: boolean = false,
  ) {
    super(message);
  }
}
```

### §11.8 Dependency Injection

- Constructor injection (no property injection)
- Interface-based injection (program to interface)
- No circular dependencies (validated at startup)

### §11.9 Comments

- Self-documenting code — no redundant comments
- Comments ONLY for:
  - WHY decisions (architecture rationale)
  - Complex algorithms (explain approach)
  - ADR references (link to decision)
  - Non-obvious side effects

### §11.10 File Organization

- One primary export per file
- Related types in same file as implementation
- DTOs in `dto/` subdirectory
- Event schemas in `events/` subdirectory
- Service interfaces in `interfaces/` subdirectory
