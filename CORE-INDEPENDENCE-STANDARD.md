# Core Independence Standard (ERP)

**Purpose**
Define strict rules and validation criteria to ensure the Core layer remains **fully independent**, reusable, and free from domain coupling.

---

# 1. Definition

## What is Core?

Core = **runtime + infrastructure + enforcement layer**

Core includes:

* DI container
* EventBus + Outbox
* Config system
* Plugin system
* Security (auth, RBAC, token management)
* Cache abstraction
* Transaction management
* Architecture enforcement (lint/runtime validation)

Core does NOT include:

* Business logic
* Domain models
* Module-specific contracts

---

# 2. Hard Independence Rules (MANDATORY)

## Rule 1 — No Domain Knowledge

Core MUST NOT contain:

* Any domain keyword (product, order, inventory, etc.)
* Business logic
* Domain validation rules

✅ Allowed:

```ts
interface Event { type: string }
```

❌ Forbidden:

```ts
if (event.type === 'product.created') { ... }
```

---

## Rule 2 — No Module Imports

Core MUST NOT import from:

```
src/modules/**
src/plugins/**
```

Violation example:

```ts
import { ProductService } from '@/modules/product' // ❌
```

---

## Rule 3 — Contract-Based Only

Core MUST interact via:

* interfaces
* tokens (symbol/string)
* generic types

✅ Allowed:

```ts
type ServiceToken<T> = symbol;
```

❌ Forbidden:

```ts
class ProductService {}
```

---

## Rule 4 — String-based Extensibility

All **domain** extensible identifiers MUST be dynamic:

* Event type → string
* Service token → symbol/string
* Plugin name → string

✅ Allowed (infrastructure enum, no domain keywords):

```ts
enum CircuitState { CLOSED, OPEN, HALF_OPEN }
enum LogLevel { DEBUG, INFO, WARN, ERROR }
```

❌ Forbidden (domain enum):

```ts
enum EventType { PRODUCT_CREATED }
enum OrderStatus { PENDING, CONFIRMED }
```

---

## Rule 5 — No Control Flow Based on Domain

Core MUST NOT branch logic based on:

* event types
* module names
* business conditions

---

## Rule 6 — Infrastructure Only

Core responsibilities limited to:

* orchestration
* enforcement
* lifecycle management

NOT allowed:

* decision making for business flows

---

# 3. Structural Constraints

## Directory Boundary

```
src/core
src/modules
src/plugins
```

Rules:

* core → cannot depend on modules/plugins
* modules → can depend on core
* plugins → can depend on core

---

## Dependency Direction

```
Core ← Modules ← Plugins
```

Never:

```
Core → Module
```

---

# 4. Event System Constraints

## Core Responsibilities

* validate structure
* enforce transaction
* persist to outbox

## Core MUST NOT

* know event semantics
* transform payload
* route based on domain

---

# 5. DI System Constraints

## Core MUST

* provide container
* resolve by token

## Core MUST NOT

* register module services internally

---

# 6. Plugin System Constraints

Core only:

* loads plugins
* validates permissions
* manages lifecycle

Core MUST NOT:

* depend on any specific plugin

Plugin MUST NOT:

* inject repository directly (must use service interface)
* access module DB directly
* emit core domain events (e.g., `order.created`)
* import module internal code

✅ Allowed (Plugin):

```ts
class MyPlugin {
  constructor(private productService: IProductService) {}
}
```

❌ Forbidden (Plugin):

```ts
class MyPlugin {
  constructor(private productRepo: ProductRepository) {}
}
```

---

# 7. Anti-Patterns (STRICTLY FORBIDDEN)

## 1. Domain Leakage

* "product" appears in core
* business rule inside core

## 2. Static Coupling

* importing module classes
* using enums for domain concepts (infrastructure enums without domain keywords are allowed)

## 3. Smart Core

* core making decisions about flows

## 4. Premature Abstraction

* designing for unknown domain cases

## 5. Plugin Boundary Violation

* plugin injecting repository directly (must use service interface)
* plugin accessing module DB directly
* plugin emitting core domain events

---

# 8. Automated Validation Checklist

## Static Checks (Lint)

* [ ] No import from modules/plugins in core (`erp/no-cross-module-import`)
* [ ] No domain keywords in core files (`erp/no-domain-keyword`)
* [ ] No domain enums in core (infrastructure enums allowed) (`erp/no-domain-enum`)
* [ ] No repository injection in plugins (`erp/no-repository-in-plugin`)
* [ ] No core domain events from plugins (`erp/no-core-event-from-plugin`)

## Runtime Checks

* [ ] DI graph contains no module dependency inside core
* [ ] Plugin permissions validated at load

## Code Review Questions

1. Does this code require knowledge of a specific module?
2. Would this still work if all modules were deleted?
3. Is this reusable in another system (non-ERP)?

If ANY answer is "no" → violation

---

# 9. Independence Test (Litmus Test)

## Test 1 — Module Removal

Remove all modules:

Expected:

* Core still compiles
* Core still starts

---

## Test 2 — Rename Domain

Rename:

* product → item

Expected:

* Core unchanged

---

## Test 3 — New Domain Injection

Add new module:

* billing

Expected:

* Core requires ZERO change

---

# 10. Scoring System

| Score  | Meaning                  |
| ------ | ------------------------ |
| 90–100 | Fully independent        |
| 70–89  | Minor leakage            |
| 50–69  | Coupling present         |
| <50    | Core is domain-dependent |

---

# 11. Golden Rule

> Core must behave like a framework, not like an application.

If Core cannot be extracted and reused in another project → it is NOT independent.

---

# 12. Summary

A valid Core must:

* know NOTHING about business
* enforce EVERYTHING about architecture
* allow ANY module to plug in without change

---

---

# 13. CI Checklist (Enforced)

## Pipeline Stages

1. **Install & Build**
2. **Lint (Architecture Rules)**
3. **Lint Spec (OpenAPI validation)**
4. **Type Check**
5. **Unit Tests**
6. **Integration Tests**
7. **Architecture Runtime Validation (boot test)**
8. **Migration Linter (if DB changes)**

---

## Required CI Gates

### Lint — Architecture (BLOCKING)

* [ ] No imports from `src/modules/**` or `src/plugins/**` inside `src/core/**`
* [ ] No domain keywords in `src/core/**` (configurable list)
* [ ] No domain enums in core (infrastructure enums allowed)
* [ ] No direct repository usage in plugins (if present)

### Lint — OpenAPI Spec (BLOCKING)

* [ ] `npm run lint:spec` passes (OpenAPI spec validation)

### Type Check (BLOCKING)

* [ ] `tsc --noEmit` passes

### Tests (BLOCKING)

* [ ] Unit tests pass
* [ ] Integration tests for Phase 1–2 flows pass

### Runtime Validation (BLOCKING)

* [ ] App boots in test mode
* [ ] DI graph validation passes
* [ ] Core-to-module dependency check passes
* [ ] Core-to-plugin dependency check passes
* [ ] Plugin permission validation passes (if plugins enabled)
* [ ] Service interface contracts validated

### DB / Migration (CONDITIONAL BLOCKING)

* [ ] Migration linter passes (ADR rules)

---

## CI Example (pseudo YAML)

```yaml
jobs:
  build:
    steps:
      - npm ci
      - npm run build

  lint:
    steps:
      - npm run lint:arch

  lint-spec:
    steps:
      - npm run lint:spec

  typecheck:
    steps:
      - npm run typecheck

  test:
    steps:
      - npm run test

  runtime-validate:
    steps:
      - npm run validate:runtime

  migration-lint:
    if: has_migration_changes
    steps:
      - npm run lint:migration
```

---

# 14. Automated Rules (Implementation)

## 14.1 ESLint — Architecture Rules

### Config Loader (`eslint.config.js`)

```js
import erpPlugin from './scripts/eslint-plugin-erp.js';

export default [
  {
    plugins: { erp: erpPlugin },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'erp/no-cross-module-import': 'error',
      'erp/no-domain-keyword': 'error',
      'erp/no-domain-enum': 'error',
    },
  },
  {
    files: ['src/plugins/**/*.ts'],
    rules: {
      'erp/no-repository-in-plugin': 'error',
      'erp/no-core-event-from-plugin': 'error',
    },
  },
];
```

### Plugin Rules Definition (`scripts/eslint-plugin-erp.js`)

```js
const DOMAIN_KEYWORDS = ['product', 'order', 'inventory', 'voucher', 'customer'];

export default {
  rules: {
    // 1) Block imports from modules/plugins in core
    'no-cross-module-import': {
      meta: {
        type: 'problem',
        messages: {
          noImport: 'Core must not import from {{source}}',
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            const source = node.source.value;
            if (source.includes('modules/') || source.includes('plugins/')) {
              context.report({ node, messageId: 'noImport', data: { source } });
            }
          },
        };
      },
    },

    // 2) No domain keywords in core
    'no-domain-keyword': {
      meta: {
        type: 'problem',
        messages: {
          noKeyword: 'Domain keyword "{{keyword}}" is not allowed in core',
        },
      },
      create(context) {
        return {
          'Identifier[name]'(node) {
            const name = node.name.toLowerCase();
            for (const kw of DOMAIN_KEYWORDS) {
              if (name.includes(kw)) {
                context.report({ node, messageId: 'noKeyword', data: { keyword: kw } });
                break;
              }
            }
          },
        };
      },
    },

    // 3) No domain enums in core (infrastructure enums allowed)
    'no-domain-enum': {
      meta: {
        type: 'problem',
        messages: {
          noDomainEnum: 'Domain enum "{{keyword}}" is not allowed in core',
        },
      },
      create(context) {
        return {
          TSEnumDeclaration(node) {
            const members = node.members || [];
            for (const member of members) {
              const name = member.id?.name?.toLowerCase() || '';
              for (const kw of DOMAIN_KEYWORDS) {
                if (name.includes(kw)) {
                  context.report({ node, messageId: 'noDomainEnum', data: { keyword: kw } });
                  break;
                }
              }
            }
          },
        };
      },
    },

    // 4) Disallow repository injection in plugins
    'no-repository-in-plugin': {
      meta: {
        type: 'problem',
        messages: {
          noRepo: 'Plugins must not depend on repositories directly',
        },
      },
      create(context) {
        return {
          'Identifier[name=/.*Repository.*/]'(node) {
            context.report({ node, messageId: 'noRepo' });
          },
        };
      },
    },

    // 5) Plugin cannot emit core domain events
    'no-core-event-from-plugin': {
      meta: {
        type: 'problem',
        messages: {
          noCoreEvent: 'Plugin cannot emit core domain events',
        },
      },
      create(context) {
        return {
          'CallExpression[callee.property.name="emit"]'(node) {
            const arg = node.arguments[0];
            if (arg?.type === 'Literal' && typeof arg.value === 'string') {
              for (const kw of DOMAIN_KEYWORDS) {
                if (arg.value.includes(kw)) {
                  context.report({ node, messageId: 'noCoreEvent' });
                  break;
                }
              }
            }
          },
        };
      },
    },
  },
};
```

---

## 14.2 Runtime Validator

### Core Validator (startup)

```ts
class ArchitectureValidator {
  async validateOnStartup(): Promise<void> {
    await this.validateDIGraph();
    await this.validateNoCoreToModule();
    await this.validateNoCoreToPlugin();
    await this.validatePluginGuards();
    await this.validateServiceInterfaces();
  }

  private async validateDIGraph(): Promise<void> {
    const graph = this.container.getDependencyGraph();
    const cycles = detectCycles(graph);
    if (cycles.length > 0) {
      throw new Error(`Circular dependencies detected: ${cycles.join(', ')}`);
    }
  }

  private async validateNoCoreToModule(): Promise<void> {
    const graph = this.container.getDependencyGraph();
    const violations = graph.edges.filter(e =>
      e.from.startsWith('core') && e.to.startsWith('modules')
    );
    if (violations.length) {
      throw new Error('Core must not depend on modules');
    }
  }

  private async validateNoCoreToPlugin(): Promise<void> {
    const graph = this.container.getDependencyGraph();
    const violations = graph.edges.filter(e =>
      e.from.startsWith('core') && e.to.startsWith('plugins')
    );
    if (violations.length) {
      throw new Error('Core must not depend on plugins');
    }
  }

  private async validatePluginGuards(): Promise<void> {
    // Validate permission manifest vs actual usage at activation time
  }

  private async validateServiceInterfaces(): Promise<void> {
    // Validate interface contracts match implementations
  }
}
```

### Boot Test Script

```json
{
  "scripts": {
    "validate:runtime": "node dist/main.js --validate-only"
  }
}
```

App mode `--validate-only`:

* boots DI
* runs validator
* exits 0/1

---

## 14.3 Independence Tests (Automated)

### Test: Core compiles without modules

```ts
// pseudo
it('core builds without modules', async () => {
  // temporarily ignore modules path via tsconfig path mapping
  // or run a separate tsconfig that excludes src/modules
});
```

### Test: Rename domain does not affect core

* Enforced indirectly by lint rule (no domain keywords)

### Test: New module requires no core change

* Verified via PR policy (no changes under src/core for new module PRs)

---

## 14.4 Package Scripts

```json
{
  "scripts": {
    "lint:arch": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint:spec": "swagger-cli validate specs/openapi.yaml",
    "lint:migration": "ts-node scripts/lint-migration.ts",
    "validate:runtime": "node dist/main.js --validate-only"
  }
}
```

---

# 15. PR Policy (Guardrail)

A PR that adds/changes modules MUST:

* NOT modify `src/core/**`
* Pass `lint:arch`, `typecheck`, `test`, `lint:spec`, `validate:runtime`

A PR that modifies `src/core/**` MUST:

* Include justification referencing this standard
* Include updated validator/lint rules if boundaries change

---

# 16. Failure Handling

If any CI gate fails:

* Block merge
* Provide exact rule violation message
* Require fix or explicit waiver (rare, reviewed)

---

**End of Standard**
