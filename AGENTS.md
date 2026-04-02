# AGENTS.md - ERP Platform Development Guide

**Version:** 1.1  
**Date:** 2026-04-01  
**Purpose:** AI-Agent development workflow for new ERP platform  
**Reference:** Architecture v2.2 (Canonical)

---

## 1. Workflow Process

### Task Classification

Agent MUST classify every request:

| Loại | Trigger | Phases | Update spec? |
|------|---------|--------|-------------|
| `full-stack-feature` | "thêm tính năng", "build feature" | Plan → Spec → Backend → Types → Frontend → Validate | Có |
| `backend-only` | "thêm API", "sửa service" | Plan → Spec (nếu đổi API) → Backend → Validate | Chỉ khi đổi contract |
| `frontend-only` | "thêm UI", "build page" | Plan → Frontend → Validate | Không |
| `bug-fix` | "fix", "sửa lỗi" | Impact → Debug → Fix → Validate | Không |
| `refactor` | "refactor", "rename" | Impact → Refactor → Detect Changes → Validate | Không |
| `plugin-develop` | "thêm plugin", "phát triển plugin" | Plan → Plugin Spec → Implement → Test → Document | Có |

### Superpowers Skills (BẮT BUỘC)

**Mọi task:**
- `using-git-worktrees` — tạo isolated workspace
- `verification-before-completion` — evidence trước khi claim done
- `finishing-a-development-branch` — merge/PR/cleanup
- `test-driven-development` — Red-Green-Refactor cycle cho MỌI code change

**Feature tasks:**
- `writing-plans` — tạo implementation plan

**Bug fix tasks:**
- `systematic-debugging` — 4 phases: Root Cause → Pattern → Hypothesis → Implementation

**Refactor tasks:**
- `gitnexus-impact-analysis` — blast radius trước khi sửa
- `gitnexus-refactoring` — safe rename/extract/split

**Plugin tasks:**
- `writing-plans` — tạo plugin implementation plan

### Subagent Dispatch

| Phase | Subagent | When |
|-------|----------|------|
| PLAN | `explore` | Khám phá codebase |
| PLAN | `engineering-software-architect` | Thiết kế architecture |
| PLAN | `engineering-backend-architect` | Thiết kế API |
| PLAN | `engineering-plugin-developer` | Plugin architecture design |
| IMPLEMENT | `engineering-senior-developer` | Backend Express.js |
| IMPLEMENT | `engineering-frontend-developer` | Frontend Next.js |
| IMPLEMENT | `engineering-plugin-developer` | Plugin implementation |
| IMPLEMENT | `engineering-security-engineer` | Auth/security |
| IMPLEMENT | `engineering-database-optimizer` | Migration, query |
| REVIEW | `engineering-code-reviewer` | Code review |
| REVIEW | `engineering-security-engineer` | Security review |
| FIX | `engineering-sre` | Production incident |
| DOCS | `engineering-technical-writer` | API docs |

**Parallel execution:**
- Backend + Frontend song song sau khi spec xong
- Code + Docs song song

### Validation Gates (MỌI task)

1. `npm run lint` — pass
2. `npm run test` (module) — pass
3. TDD verification — evidence of RED→GREEN cycle cho mỗi behavior
4. `gitnexus_detect_changes()` — scope match
5. Nếu spec changed → `npm run lint:spec`
6. Nếu là plugin → validate plugin manifest + `trusted` flag (v2.2)
7. Nếu thay đổi event → validate event schema (ADR-008)
8. Nếu là migration → `npm run lint:migration` (ADR-009)

---

## 2. Git Rules

- Branch: `feat/{module}/{desc}`, `fix/{module}/{desc}`, `plugin/{name}/{desc}`
- Worktree: `.worktrees/{branch-name}/`
- Commit: `type(scope): description`
- KHÔNG commit `.env`, `node_modules/`, `dist/`
- KHÔNG force push, amend trên main

---

## 3. OpenAPI Spec-First

1. Update `specs/openapi.yaml` FIRST
2. `npm run lint:spec`
3. Implement backend (Express routes + Zod validation match spec)
4. Implement frontend when available: generate types from spec, use generated types
5. (Frontend `apps/` directory does not exist yet — skip step 4 for now)

---

## 4. Agent Prohibitions

- KHÔNG sửa `.env`, `docker-compose.yml`, `package.json` deps, `tsconfig.*.json`
- KHÔNG sửa infrastructure configs (docker-compose, k8s, terraform)
- CHỈ ĐƯỢC sửa app configs (plugins.json)
- KHÔNG commit secrets, keys vào repo
- KHÔNG modify `.env` files
- KHÔNG access production directly
- KHÔNG delete resources (database, buckets, etc.)
- KHÔNG commit vào main
- KHÔNG tạo type thủ công khi spec đã có
- KHÔNG sửa backend API mà không update spec
- KHÔNG direct DB access (phải qua API)

---

## 5. TDD Rules (BẮT BUỘC)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Mỗi behavior = 1 TDD cycle:
1. **RED** — Write ONE failing test → verify FAILS
2. **GREEN** — Write minimal code → verify PASSES
3. **REFACTOR** — Clean up → verify still PASSES

Cho bug fix: Write failing test reproducing bug FIRST → fix → verify PASSES.

Evidence required: `npm test → FAIL` (RED) then `npm test → PASS` (GREEN) per behavior.

---

## 6. Code Standards

### Naming Convention: Layer-Based

Mỗi layer giữ convention riêng, convert tại boundary:

| Layer | Convention | Ví dụ |
|-------|-----------|-------|
| **TypeScript code** (entities, DTOs, services, controllers) | `camelCase` | `cartId`, `paymentMethod`, `basePrice` |
| **PostgreSQL columns** | `snake_case` | `cart_id`, `payment_method`, `base_price` |
| **API contract** (OpenAPI spec, request/response) | `snake_case` | `cart_id`, `payment_method`, `base_price` |
| **Frontend types** (auto-generated from spec) | `snake_case` | `cart_id`, `payment_method`, `base_price` |

### Transformation Architecture

```
Request:  Frontend (snake_case)
    → snakeCaseMiddleware (global middleware, converts req.body keys to camelCase)
    → DTO (camelCase)
    → Controller/Service (camelCase)

Response: Service/Entity (camelCase)
    → snakeCaseResponseMiddleware (global middleware, converts res.json keys to snake_case)
    → API response (snake_case)
    → Frontend (snake_case)

Database: Schema pgTable() (camelCase property)
    → Column mapping: `basePrice: decimal('base_price')` (snake_case column)
    → PostgreSQL column (snake_case)
```

### Rules

**Schemas (`*.schema.ts`):**
- Drizzle `pgTable()` definition: TypeScript property `camelCase`, DB column `snake_case` (explicit mapping)
- Column mapping: `basePrice: decimal('base_price', { precision: 15, scale: 2 })` — explicit per column
- KHÔNG rely vào naming strategy — tất cả mapping phải explicit trong `pgTable()`
- Schema file = source of truth cho cả queries và migrations (drizzle-kit)

**DTOs (`*.dto.ts`):**
- TẤT CẢ property names PHẢI là `camelCase` — `cartId`, `paymentMethod`
- KHÔNG dùng `snake_case` trong DTO properties
- Request body `snake_case` từ client → `snakeCaseMiddleware` tự convert

**Controllers (`*.controller.ts`):**
- Return raw entity/service result — KHÔNG manual convert naming
- `snakeCaseResponseMiddleware` tự xử lý response keys

**Services (`*.service.ts`):**
- Dùng `camelCase` cho mọi biến, return value
- KHÔNG convert naming trong service layer

**OpenAPI Spec (`specs/openapi.yaml`):**
- TẤT CẢ schema properties PHẢI là `snake_case`
- Match với actual API response (sau snakeCaseResponseMiddleware)

**Frontend:**
- Generated types từ spec → dùng `snake_case`
- KHÔNG tạo custom type với `camelCase` khi đã có generated type `snake_case`

### KHÔNG

- KHÔNG dùng `snake_case` cho DTO property names
- KHÔNG dùng `camelCase` cho OpenAPI spec schema properties
- KHÔNG manual convert naming trong controller/service (dùng global middleware)
- KHÔNG tạo custom frontend types khi đã có generated types từ spec

---

## 7. Plugin Development

### 7.1 Plugin Structure

```
backend/src/plugins/{plugin-name}/
├── {plugin-name}.module.ts      # Entry point (IPlugin)
├── {plugin-name}.service.ts     # Main service
├── {plugin-name}.controller.ts  # API endpoints
├── schema.ts                    # Drizzle pgTable schema (NOT entities/)
├── dto/
│   ├── create-{plugin-name}.dto.ts
│   └── update-{plugin-name}.dto.ts
├── events/                      # Domain events
│   └── {plugin-name}.events.ts
└── docs/
    ├── README.md
    ├── API.md
    ├── ARCHITECTURE.md
    └── CHANGELOG.md

plugins/{plugin-name}/
├── package.json                 # Plugin manifest
├── config.json                  # Default configuration
└── dist/                        # Compiled output
```

### 7.2 Plugin Interface

```typescript
interface IPlugin {
  getMetadata(): PluginMetadata;
  getModules(): unknown[];

  // Lifecycle hooks
  init(db: Db): void;
  onActivate(): Promise<void>;      // REQUIRED
  onDeactivate(): Promise<void>;    // REQUIRED
  onInstall?(): Promise<void>;
  onUninstall?(): Promise<void>;
  dispose(): Promise<void>;         // MANDATORY
}

interface PluginPermission {
  resource: string;          // e.g., "product", "order", "external:smtp"
  actions: string[];         // e.g., ["read", "write"] or ["call"]
  scope?: string;            // e.g., "plugin_analytics_*" for isolated storage
}

interface PluginMetadata {
  name: string;           // Unique identifier
  version: string;        // Date-based: YYYY.MM.DD
  description: string;
  author?: string;
  dependencies?: { name: string; version: string }[];
  enabled: boolean;
  config?: Record<string, unknown>;
  permissions?: PluginPermission[];
  trusted?: boolean;      // NEW in v2.2 - Phase 1 plugins are TRUSTED ONLY
}
```

### 7.3 Plugin Security (v2.2 - CRITICAL)

> **⚠️ PHASE 1 = TRUSTED PLUGINS ONLY**
> Phase 1 plugins run in the same process as the main application. This means:
> - Plugin CAN access Node.js globals (Buffer, fs, process.env)
> - Plugin crash CAN crash the main process
> - No memory isolation or resource enforcement

```typescript
// Plugin metadata phải khai báo trusted flag
const pluginConfig = {
  name: 'my-plugin',
  version: '2026.04.01',
  description: 'My plugin',
  trusted: true,  // Phase 1: Chỉ cài đặt plugin từ nguồn trusted
};

// ❌ KHÔNG cài đặt untrusted plugin trong Phase 1
// Untrusted plugin phải đợi Phase 2+ isolation
```

### 7.4 Plugin Manifest

```json
{
  "name": "plugin-name",
  "version": "2026.03.31",
  "description": "Plugin description",
  "entry": "./dist/index.js",
  "dependencies": {
    "@erp/core": ">=1.0.0"
  }
}
```

### 7.5 Plugin Configuration

```json
// config/plugins.json
{
  "plugins": {
    "product": {
      "enabled": true,
      "config": {
        "maxVariants": 100,
        "allowNegativeStock": false
      }
    }
  }
}
```

### 7.6 Plugin Workflow

1. **Plan** → Define plugin interface + metadata (bao gồm `trusted` flag cho Phase 1)
2. **Spec** → Update OpenAPI spec
3. **Implement** → Create module, service, entities
4. **Test** → TDD: Red → Green → Refactor
5. **Document** → Create docs in `plugins/{name}/docs/`
6. **Register** → Add to `plugins.json`
7. **Security Check** → Validate `trusted` flag, chỉ cài đặt plugin trusted trong Phase 1

---

## 8. Event Architecture Guidelines

### 8.1 Event Schema (ADR-002 + ADR-008)

```typescript
interface IEvent {
  id: string;                    // UUID v4
  type: string;                  // "{module}.{action}.v{version}"
  source: string;                // service name
  timestamp: string;             // ISO8601
  aggregate_id: string;          // REQUIRED, top-level (per ADR-002)
  payload: object;              // domain data
  metadata: {
    version: string;            // Event schema version: "v1", "v2"
    correlation_id?: string;    // For tracing related events
    causation_id?: string;      // Original event that caused this
  };
}
```

### 8.2 Event Schema Registry (ADR-008 - NEW in v2.2)

> **BẮT BUỘC:** Tất cả event phải được validated qua registered schema trước khi emit và sau khi receive.

```typescript
import { z } from 'zod';

// Đăng ký schema cho mỗi event type
const ProductCreatedEventSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('product.created.v1'),
  source: z.string(),
  timestamp: z.string().datetime(),
  aggregate_id: z.string().uuid(),
  payload: z.object({
    productId: z.string().uuid(),
    productName: z.string().min(1).max(255),
    basePrice: z.number().positive(),
  }),
  metadata: z.object({
    version: z.literal('v1'),
  }),
});

// Producer validate trước khi emit
eventBus.emit(event, tx, ProductCreatedEventSchema);

// Consumer validate sau khi receive
consumer.onMessage(event => {
  EventSchemaRegistry.validate(event.type, event);
});
```

### 8.3 Event Naming

- Format: `{module}.{action}.v{version}`
- Examples: `product.created.v1`, `order.completed.v1`, `inventory.reserved.v1`
- All lowercase, snake_case, version suffix required

### 8.4 Event Rate Limiting (v2.2 - NEW)

Mỗi event type phải có rate limit để tránh event storm:

```typescript
const defaultEventRateLimits = [
  { eventType: 'order.created', maxEventsPerSecond: 100 },
  { eventType: 'product.created', maxEventsPerSecond: 500 },
  { eventType: 'inventory.reserved', maxEventsPerSecond: 200 },
];
```

### 8.5 Outbox Pattern + Push Option (v2.2)

```
1. Service saves event to `outbox` table (same transaction as domain)
2. Scheduler polls outbox → publishes to RabbitMQ
3. Consumer processes → marks as processed
```

**Optional Push-Based (v2.2):** PostgreSQL LISTEN/NOTIFY cho low-latency delivery:
```typescript
await this.db.listen('outbox_notify', async () => {
  this.immediatePoll = true;  // Trigger poll on notification
});
```

### 8.6 Outbox Schema (Drizzle)

> Per ADR-001: System uses Outbox Pattern (NOT Event Sourcing). No `event_store` for replay.

```typescript
// backend/src/core/outbox/schema.ts
export const outbox = pgTable('outbox', {
  id:          uuid('id').defaultRandom().primaryKey(),
  eventId:     uuid('event_id').notNull(),
  eventType:   varchar('event_type', { length: 255 }).notNull(),
  source:      text('source').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  payload:     jsonb('payload').notNull(),
  metadata:    jsonb('metadata'),
  status:      varchar('status', { length: 50 }).default('pending').notNull(),
  attempts:    integer('attempts').default(0).notNull(),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
});
```

### 8.7 Event Types by Module

| Module | Event Types |
|--------|------------|
| Product | `product.created.v1`, `product.updated.v1`, `product.deactivated.v1` |
| Order | `order.created.v1`, `order.confirmed.v1`, `order.cancelled.v1`, `order.completed.v1` |
| Inventory | `inventory.reserved.v1`, `inventory.released.v1`, `inventory.adjusted.v1` |
| Voucher | `voucher.created.v1`, `voucher.redeemed.v1`, `voucher.expired.v1` |
| Wallet | `wallet.credited.v1`, `wallet.debited.v1`, `wallet.created.v1` |
| Loyalty | `points.earned.v1`, `points.redeemed.v1`, `tier.upgraded.v1` |
| CRM | `customer.created.v1`, `customer.updated.v1`, `tag.added.v1` |

---

## 8.8 Migration Rule Enforcement (ADR-009 - NEW in v2.2)

Migration rules được enforce qua migration linter trong CI pipeline.

```bash
# Run migration linter trước khi migrate
npm run lint:migration
```

### Rules được enforce:

| Rule | Description |
|------|-------------|
| `no-not-null-without-default` | KHÔNG thêm NOT NULL column không có default |
| `statement-timeout-set` | Migration phải set `statement_timeout` |
| `reversible-sql-only` | Destructive statements cần manual review |

### Migration Workflow

```
1. Tạo schema changes trong *.schema.ts
2. Run: npx drizzle-kit generate
3. Run: npm run lint:migration
4. Nếu pass → npx drizzle-kit migrate
5. Nếu fail → sửa theo lint errors
```

---

## 9. Documentation Requirements

### Per Module Documentation

Location: `modules/{name}/docs/`

| Document | Required | Description |
|----------|----------|-------------|
| **README.md** | ✅ | Quick start, overview, setup |
| **API.md** | ✅ | Endpoints, request/response schemas |
| **ARCHITECTURE.md** | ✅ | Design decisions, data flow, patterns |
| **CHANGELOG.md** | ✅ | Version history, breaking changes |

### README Template

```markdown
# {Module Name}

## Overview
Brief description of the module.

## Quick Start
Installation and basic usage.

## Features
List of features.

## Configuration
Default configuration options.

## API Reference
Link to API.md
```

### CHANGELOG Format

```markdown
# Changelog

## [2026.03.31]
### Added
- Feature A
- Feature B

### Changed
- Update C

### Fixed
- Bug D
```

### Auto-generate
- API docs from OpenAPI spec
- Type definitions from spec (frontend)

---

## 10. AI-Agent Permissions

| Action | Permission |
|--------|------------|
| **Commit directly** | ✅ Yes |
| **Merge to main** | ❌ No (human approval required) |
| **Modify app configs** | ✅ Yes (e.g., plugins.json) |
| **Modify infra configs** | ❌ No |
| **Access production** | ❌ No |
| **Delete resources** | ❌ No |
| **Modify .env** | ❌ No |
| **Commit secrets** | ❌ No |
| **Direct DB access** | ❌ No (must use API) |

---

## 11. GitNexus Integration

This project uses GitNexus for code intelligence. Run `npx gitnexus analyze` after major changes.

### Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.

### When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

### When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` and `gitnexus_impact({target: "target", direction: "upstream"})` before moving code
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed

### Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope

---

## 12. Testing Requirements

### Coverage Target
- **Minimum**: 80% code coverage

### E2E Framework
- **Jest** for unit, integration, and E2E testing
- **Playwright** for end-to-end testing (future — not yet configured)

### TDD Approach
- **Full TDD**: Red → Green → Refactor cho mọi feature

---

## 13. Deployment

- **Docker Compose** cho self-hosted deployment
- **GitHub Actions** cho CI/CD
- **Prometheus + Grafana + Loki** cho monitoring

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **mini-erp** (181 symbols, 179 relationships, 0 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/mini-erp/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/mini-erp/context` | Codebase overview, check index freshness |
| `gitnexus://repo/mini-erp/clusters` | All functional areas |
| `gitnexus://repo/mini-erp/processes` | All execution flows |
| `gitnexus://repo/mini-erp/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
