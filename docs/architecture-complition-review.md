---
BÁO CÁO REVIEW: Tuân thủ Architecture v2.2 & PROJECT-STANDARD
Ngày: 2026-04-01  
Phạm vi: Toàn bộ codebase backend/  
Tài liệu chuẩn: Architecture-v2.2.md, PROJECT-STANDARD.md, AGENTS.md
---
TÓM TẮT ĐÁNH GIÁ
Hạng mục
Cấu trúc thư mục
Layer rules
Naming convention
Event Architecture
Plugin System
Database/ORM
API Standards
Config Validation
ESLint Architecture
Testing
TOCTOU Race Condition
---
CHI TIẾT TỪNG HẠNG MỤC
1. CẤU TRÚC THƯ MỤC — ✅ Tuân thủ
backend/src/
├── core/         ✅ Đúng: DI, EventBus, Config, PluginLoader, Saga, Auth, Cache, etc.
├── modules/      ✅ Đúng: product (module, service, controller, schema, dto, events, interfaces)
├── plugins/      ⚠️ Một phần: analytics (thiếu cấu trúc chuẩn)
├── shared/       ✅ Đúng: constants, errors, types, utils
└── main.ts       ✅ Đúng: bootstrap entry point
Tuân thủ PROJECT-STANDARD §1: ✅ PASS
---
2. LAYER RULES — ✅ Tuân thủ
Rule
core chỉ import shared
modules chỉ import core (interfaces) + shared
plugins chỉ import core (interfaces) + shared
Không cross-module import
shared là leaf layer
ESLint rules enforcement: 6 custom rules configured — no-cross-module-import, no-repository-in-plugin, no-core-event-from-plugin, no-outbox-direct-access, no-infra-config-import, no-plugin-import-from-module
Tuân thủ Architecture v2.2 §37 (ADR-006): ✅ PASS
---
3. DATABASE / SCHEMA / ORM — ✅ Tuân thủ
Schema (product.schema.ts):
- ✅ camelCase property → snake_case column explicit mapping
- ✅ pgTable() from drizzle-orm/pg-core
- ✅ Indexes defined (products_sku_idx, products_active_idx)
- ✅ Schema file is source of truth
Outbox schema (outbox.schema.ts):
- ✅ Matches Architecture v2.2 §32 exactly
- ✅ outbox_dlq table defined
- ✅ Indexes on status and created_at
Saga schema (saga.schema.ts):
- ✅ Includes ttl_at field per v2.2
- ✅ Proper indexes
Processed events schema (processed-event.schema.ts):
- ✅ eventId unique constraint
- ✅ Proper structure for deduplication
Migration linter (scripts/lint-migrations.ts):
- ✅ Implements all 3 rules: no-not-null-without-default, statement-timeout-set, reversible-sql-only
- ✅ CLI entry point with exit codes
Tuân thủ Architecture v2.2 §5 (ADR-007) + ADR-009: ✅ PASS
---
4. EVENT ARCHITECTURE — ⚠️ CÓ VI PHẠM
🔴 VI PHẠM 1: Event Schema Registration Mismatch
Vị trí: product.module.ts:43 vs product.service.ts:183
// product.module.ts — ĐĂNG KÝ SAI event type
this.config.schemaRegistry.register('product.deleted.v1', ProductDeletedEventSchema);
// product.service.ts — EMIT ĐÚNG event type
type: 'product.deactivated.v1'  // ← Registry KHÔNG có schema cho type này!
Tác động: Khi EventBus.emit() gọi schemaRegistry.validate('product.deactivated.v1', event), nó sẽ throw vì không tìm thấy schema. Tất cả delete operations sẽ FAIL at runtime.
Fix: Thay product.module.ts:43:
// TRƯỚC
this.config.schemaRegistry.register('product.deleted.v1', ProductDeletedEventSchema);
// SAU
this.config.schemaRegistry.register('product.deactivated.v1', ProductDeactivatedEventSchema);
✅ Các phần khác tuân thủ tốt:
- ADR-001 (Outbox): EventBus.emit() ghi vào outbox table, không publish trực tiếp → ✅
- ADR-002 (aggregate_id top-level): Tất cả emit calls đều có aggregate_id ở top-level → ✅
- ADR-005 (tx parameter): EventBus.emit() throw nếu thiếu tx → ✅
- ADR-008 (Schema Registry): EventSchemaRegistry validate trước khi persist → ✅ (trừ bug ở trên)
- Event naming: {module}.{action}.v{version} format → ✅
---
5. PLUGIN SYSTEM — ⚠️ NHIỀU VI PHẠM
🔴 VI PHẠM 2: Plugin thiếu cấu trúc thư mục chuẩn
Architecture v2.2 §7.1 (AGENTS.md) yêu cầu:
backend/src/plugins/{name}/
├── {name}.module.ts      ← THIẾU
├── {name}.service.ts     ← THIẾU
├── {name}.controller.ts  ← THIẾU
├── schema.ts             ← THIẾU
├── dto/                  ← THIẾU
├── events/               ← THIẾU
└── docs/                 ← THIẾU
Thực tế: Tất cả logic gom vào 1 file analytics.plugin.ts (105 lines).
Tác động: Khi plugin mở rộng, vi phạm Single Responsibility. Không có schema cho plugin_analytics_* tables (dù permission khai báo quyền read/write).
🟡 VI PHẠM 3: Thiếu Plugin Manifest (package.json)
AGENTS.md §7.4 yêu cầu:
{
  "name": "analytics",
  "version": "2026.04.01",
  "description": "...",
  "entry": "./dist/index.js",
  "dependencies": { "@erp/core": ">=1.0.0" }
}
Thực tế: Không có plugins/analytics/package.json.
🟡 VI PHẠM 4: Plugin Storage In-Memory
// analytics.plugin.ts
private events: AnalyticsEventRecord[] = [];  // ← Mất data khi restart
Permission khai báo { resource: 'plugin_analytics_*', actions: ['read', 'write'] } nhưng không có schema table. Data chỉ lưu trong RAM → mất khi restart process.
✅ Các phần tuân thủ tốt:
- trusted: true → ✅ Phase 1 requirement
- Không import @modules/ → ✅
- Không emit core domain events → ✅
- Permission manifest có declare → ✅
---
6. NAMING CONVENTION — ✅ Tuân thủ
Layer
TypeScript code
PostgreSQL columns
API contract (OpenAPI)
Drizzle pgTable mapping
DTO properties
Class names
Constants
Files
Snake/Camel case conversion:
- Request: snakeCaseMiddleware → convert incoming → ✅
- Response: snakeCaseResponseMiddleware → convert outgoing → ✅
- payload key skipped → ✅
---
7. API STANDARDS — ⚠️ CÓ VẤN ĐỀ
🟡 VẤN ĐỀ 1: Cursor Pagination Giả
product.service.ts:35:
async list(limit: number, _cursor?: string): Promise<{ items: Product[]; nextCursor: string | null }> {
  // _cursor được prefix với _ → intentionally unused
  // Không implement cursor-based pagination
}
OpenAPI spec, API docs, và response format đều advertise cursor pagination nhưng không implement. Controller vẫn trả nextCursor và has_more nhưng chỉ dựa vào LIMIT + 1 trick.
✅ Các phần tuân thủ tốt:
- URL versioning /api/v1/ → ✅
- Response envelope {data, meta} / {error} → ✅
- meta.request_id mandatory → ✅
- Zod validation cho request DTOs → ✅
- Optimistic locking (version field) → ✅
- Soft delete (isActive: false) → ✅
---
8. CONFIG VALIDATION (ADR-004) — ✅ Tuân thủ
// config/config.ts
const ConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  database: z.object({ host, port, user, password, name }),
  jwt: z.object({ publicKey, privateKey, accessTokenTtl, refreshTokenTtl }),
  rabbitmq: z.object({ url: z.string().url() }),
  redis: z.object({ url: z.string().min(1) }),
  logLevel: z.enum([...]),
});
- ✅ Schema validation với Zod
- ✅ process.exit(1) on failure (fail-fast)
- ✅ Covers all required config sections
---
9. ERROR HANDLING — ✅ Tuân thủ
// shared/errors/app-error.ts
class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: object,
    public readonly retryable: boolean = false,
  ) { super(message); }
}
- ✅ Typed error codes (VALIDATION_ERROR, NOT_FOUND, CONFLICT, etc.)
- ✅ httpStatus mapping
- ✅ retryable flag
- ✅ Global error handler (globalErrorHandler) → standard ApiErrorResponse
- ✅ Plugin-specific error codes: CIRCUIT_OPEN, PLUGIN_NOT_ACTIVE, SAGA_FAILED
---
10. TESTING — ⚠️ NHIỀU VẤN ĐỀ
🟡 VẤN ĐỀ 2: Placeholder Tests (Pass không có assertion)
// tests/core/api/rate-limiter.test.ts
it('should allow requests within limit', () => {
  expect(true).toBe(true); // Placeholder ← KHÔNG TEST GÌ
});
// tests/core/saga/saga-orchestrator.test.ts
it('should persist saga state on start', () => {
  expect(true).toBe(true);  // ← Placeholder
});
3 test suites hoàn toàn là placeholder:
- tests/core/api/rate-limiter.test.ts — 3 tests, tất cả expect(true).toBe(true)
- tests/core/saga/saga-orchestrator.test.ts — 3 tests, tất cả placeholder
- tests/core/config/database.test.ts — 1 test, chỉ test string concatenation
🟡 VẤN ĐỀ 3: Coverage Threshold Không Reflect Thực Tế
// jest.config.ts
"coverageThreshold": {
  "global": { "branches": 80, "functions": 80, "lines": 80, "statements": 80 }
}
Với placeholder tests đạt 80% threshold → coverage số liệu không có ý nghĩa vì tests không verify behavior thực.
✅ Tests thực sự có giá trị:
- cache.service.test.ts — 6 tests, test distributed lock, mutex, fallback → ✅
- event-bus.test.ts — 4 tests, test tx enforcement, schema validation → ✅
- product.service.test.ts — 6 tests, test CRUD, TOCTOU prevention → ✅
- response.test.ts — 8 tests, test snake_case conversion, envelope format → ✅
- analytics.plugin.test.ts — 4 tests, test lifecycle, event tracking → ✅
---
11. TOCTOU RACE CONDITION — 🔴 BUG
🔴 BUG 1: delete() Check Ngoài Transaction
Vị trí: product.service.ts:168-196
async delete(id: string): Promise<void> {
  const existing = await this.getById(id);  // ← OUTSIDE transaction
  if (!existing) throw new AppError(...);
  await (this.db as any).transaction(async (tx_) => {
    // existing có thể STALE nếu concurrent request đã delete/update
    await tx.update(products).set({ isActive: false, ... });
    await this.eventBus.emit({ type: 'product.deactivated.v1', payload: { ...existing.productName } }, tx);
  });
}
Vấn đề: Giữa getById() và transaction(), concurrent request có thể:
1. Update product → existing dùng data cũ
2. Delete product → emit event với data không chính xác
Contrast: update() method đúng — read inside transaction (line 112-130).
Fix: Move existence check + read inside transaction, giống như update().
---
12. MIDDLEWARE ORDER — ⚠️ VẤN ĐỀ TIỀM ẨN
main.ts:37-39:
app.use(requestIdMiddleware);
app.use(snakeCaseMiddleware);      // Converts request body
app.use(snakeCaseResponseMiddleware); // Intercepts res.json
Vấn đề: snakeCaseResponseMiddleware intercept res.json() trước khi các route handlers chạy. Nếu middleware order thay đổi trong tương lai, response conversion sẽ bị bỏ qua.
Ngoài ra, authMiddleware chỉ apply cho /api routes (app.use('/api', authMiddleware(config))) → health endpoints không cần auth → ✅ đúng thiết kế.
---
13. AnyDb TYPE — ⚠️ KIỂU DỮ LIỆU
type AnyDb = Record<string, unknown>;  // ← Không type safety
// Dùng everywhere: this.db as any, tx_ as any
Tác động:
- Bypass TypeScript type checking cho toàn bộ database layer
- IDE không hỗ trợ autocomplete cho Drizzle methods
- Dễ introduce runtime errors từ typos trong query
Nên dùng: PgDatabase type từ drizzle-orm/pg-core hoặc ít nhất DrizzleClient interface.
---
14. OBSERVABILITY — ⚠️ CHƯA IMPLEMENT
Architecture v2.2 §23 yêu cầu:
- OpenTelemetry tracing → ❌ Không có code
- Prometheus /metrics endpoint → ❌ Không register
- Pino structured logging → ❌ Dùng console.log/console.error everywhere
- Correlation ID propagation → ⚠️ Middleware attach request_id nhưng không propagate qua events
main.ts dùng:
console.log(`ERP Backend running on port ${config.port}`);  // ← Không phải structured logging
console.error('Redis connection error:', err);               // ← Không có context
Dependencies đã install (pino, prom-client) nhưng không sử dụng.
---
15. AUTH — ⚠️ THIẾU MỘT SỐ PHẦN
Architecture v2.2 §20 + PROJECT-STANDARD §10 yêu cầu:
- JWT RS256 → ✅ Implemented
- Token revocation (Redis blacklist) → ❌ Không implement
- Refresh token rotation → ❌ Không implement
- RBAC (requireRole, requirePermission) → ✅ Implemented
- Rate limiting per endpoint → ⚠️ Global only, không per-endpoint custom
---
16. SAGA — ⚠️ STUB CODE
sagas/order.saga.ts trong product module:
- ❌ File ở sai module (order saga nên ở modules/order/)
- ❌ Tất cả step implementations là stubs (placeholder logic)
- ❌ Không call service interfaces thực tế
- ❌ SagaOrchestrator tests là placeholder
---
TỔNG HỢP VI PHẠM
🔴 P0 — Cần fix ngay (sẽ gây crash/bug ở production)
#	Vấn đề
1	Event schema registration mismatch
2	TOCTOU race condition trong delete()
🟡 P1 — Nên fix (vi phạm kiến trúc, technical debt)
#	Vấn đề
3	Plugin thiếu cấu trúc chuẩn
4	Thiếu plugin manifest
5	Placeholder tests
6	Observability chưa implement
7	Token revocation chưa implement
8	Cursor pagination giả
9	AnyDb type thay vì Drizzle type
10	Order saga ở sai module
💭 P2 — Nice to have
#
11
12
13
---
## RỦI RO KIẾN TRÚC TƯƠNG LAI
### 1. 🔴 EVENT SCHEMA DRIFT — Nguy cơ CỰC CAO
Sự mismatch giữa `product.deleted.v1` (registered) và `product.deactivated.v1` (emitted) cho thấy **không có cơ chế tự động verify** rằng tất cả emit calls đều có registered schema. Khi thêm module mới, developer có thể:
- Quên đăng ký event schema → runtime crash
- Đăng ký sai event type name → silent failure (validation pass nhưng consumer không nhận)
**Khuyến nghị:** Thêm startup validation check: iterate tất cả emit calls trong codebase, verify mỗi event type đều có registered schema.
### 2. 🟡 CROSS-MODULE COUPLING qua Saga
`order.saga.ts` trong product module import `SagaOrchestrator` từ core. Khi order module được tạo, saga logic cần được move. Nếu không move sớm, developer mới có thể coi đây là pattern chuẩn và tạo thêm sagas trong product module.
### 3. 🟡 PLUGIN GROWTH PATTERN
Analytics plugin là single-file. Khi có thêm plugins, nếu tuân theo pattern này thay vì cấu trúc thư mục chuẩn, hệ thống sẽ mất tính modularity.
### 4. 🟡 TESTING BASELINE EROSION
Placeholder tests tạo false sense of security. Nếu coverage threshold 80% được enforce trong CI với placeholder tests, developer sẽ nghĩ code đã được test đầy đủ trong khi thực tế không có behavior verification.
### 5. 🟡 TYPE SAFETY EROSION
`AnyDb = Record<string, unknown>` + `as any` casts ở khắp nơi. Nếu pattern này tiếp tục khi có thêm modules, TypeScript sẽ không catch được runtime errors từ typos trong column names, wrong query syntax, etc.
---
KHUYẾN NGHỊ ƯU TIÊN
Tuần 1 (Critical):
1. Fix event schema registration mismatch (product.module.ts:43)
2. Fix TOCTOU trong delete() — move check inside transaction
3. Implement cursor pagination thực tế hoặc remove từ API contract
Tuần 2 (High):
4. Restructure analytics plugin theo chuẩn directory layout
5. Thêm plugin manifest package.json
6. Replace placeholder tests với tests thực tế
7. Implement pino structured logging thay vì console.log
Tuần 3 (Medium):
8. Move order.saga.ts sang order module (khi tạo)
9. Thêm token revocation (Redis blacklist)
10. Replace AnyDb với Drizzle PgDatabase type
11. Implement Prometheus /metrics endpoint
---