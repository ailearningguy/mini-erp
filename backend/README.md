# ERP Backend

Production-ready ERP backend skeleton with enforced architecture rules.

## Architecture

```
Core (Kernel) → Modules (Domain) → Plugins (Extensions)
```

### Core Systems

| System | Description | Location |
|--------|-------------|----------|
| **Config** | Zod schema validation, fail-fast on startup | `src/core/config/` |
| **DI Container** | Circular dependency detection at startup | `src/core/di/` |
| **EventBus** | Transaction-enforced emit (ADR-005) | `src/core/event-bus/` |
| **Outbox** | Worker with SKIP LOCKED, retry, DLQ | `src/core/outbox/` |
| **Event Schema Registry** | Producer + consumer validation (ADR-008) | `src/core/event-schema-registry/` |
| **Event Consumer** | Dedup, double-check, per-aggregate FIFO | `src/core/consumer/` |
| **Idempotency** | Redis API store + processed_events DB | `src/core/idempotency/` |
| **Saga** | Centralized orchestrator with state machine | `src/core/saga/` |
| **Plugin System** | Lifecycle, permissions, trusted-only (Phase 1) | `src/core/plugin-system/` |
| **External Integration** | Circuit breaker, proxy layer | `src/core/external-integration/` |
| **API Layer** | Express, validation, response envelope | `src/core/api/` |
| **Cache** | Redis cache-aside with fail-safe | `src/core/cache/` |
| **Architecture Validator** | Runtime DI + binding validation | `src/core/architecture-validator/` |

### Example Module (Product)

Full CRUD with event emission — the "golden path" implementation:

```
src/modules/product/
├── product.module.ts        # Module registration + route setup
├── product.service.ts       # Business logic with transactions
├── product.controller.ts    # HTTP endpoints
├── product.schema.ts        # Drizzle pgTable definition
├── dto/                     # Zod-validated DTOs
├── events/                  # Event schemas (product.created.v1, etc.)
├── interfaces/              # Service interface (IProductService)
└── sagas/                   # Example order saga
```

### Example Plugin (Analytics)

```
src/plugins/analytics/
└── analytics.plugin.ts      # Event subscription + permission manifest
```

## Quick Start

### Prerequisites

- Node.js >= 22
- PostgreSQL 16+
- Redis 7+
- RabbitMQ 3.13+

### Setup

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# Edit .env with your database/redis/rabbitmq credentials

# Run migrations
npm run migrate

# Seed sample data
npm run seed

# Start development server
npm run dev
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled code |
| `npm run lint` | ESLint + architecture rules |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | Jest tests |
| `npm run migrate` | Run database migrations |
| `npm run migrate:generate` | Generate migration from schema changes |
| `npm run lint:migration` | Validate migration files (ADR-009) |
| `npm run outbox-worker` | Start outbox worker process |

## Architecture Enforcement

### Compile-time (ESLint)

| Rule | Description |
|------|-------------|
| `no-cross-module-import` | Module A cannot import Module B directly |
| `no-outbox-direct-access` | Only core can access outbox table |
| `no-repository-in-plugin` | Plugin cannot inject repository |
| `no-core-event-from-plugin` | Plugin cannot emit core domain events |
| `no-infra-config-import` | Cannot import docker/k8s configs |

### Runtime (Startup)

- DI graph validation (circular dependency detection)
- Service binding validation (required core services registered)
- Plugin permission validation at activation

### CI Pipeline

```bash
npm run lint           # ESLint + architecture rules
npm run typecheck      # TypeScript strict
npm run test           # Unit + integration
npm run lint:spec      # OpenAPI validation
npm run lint:migration # Migration linter
```

## Event Flow

```
API Request
  → Service creates domain data
  → EventBus.emit(event, tx) writes to outbox (SAME transaction)
  → COMMIT

Outbox Worker (separate process):
  → Poll outbox (FOR UPDATE SKIP LOCKED)
  → Publish to RabbitMQ
  → Mark as processed
  → Failed → retry with exponential backoff → DLQ after max attempts

Event Consumer:
  → Receive from RabbitMQ
  → Validate schema (ADR-008)
  → Check dedup (processed_events)
  → Enqueue per aggregate_id (FIFO)
  → Process in transaction → mark processed → ACK
```

## Naming Conventions

| Layer | Convention | Example |
|-------|-----------|---------|
| TypeScript code | `camelCase` | `cartId`, `basePrice` |
| PostgreSQL columns | `snake_case` | `cart_id`, `base_price` |
| API contract | `snake_case` | `cart_id`, `base_price` |
| Drizzle pgTable | explicit mapping | `basePrice: decimal('base_price')` |

## Documentation

- [Architecture v2.2](../docs/architecture-v2.2.md) — Canonical architecture reference
- [Implementation Checklist](../docs/ERP-Architecture-v2.2-Implementation-Checklist.md)
- [PROJECT-STANDARD.md](../PROJECT-STANDARD.md) — Coding standards
