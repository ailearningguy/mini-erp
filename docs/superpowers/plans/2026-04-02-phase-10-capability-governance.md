# Phase 10: Capability Governance (Versioning + Compatibility) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioning, compatibility checking, deprecation lifecycle, and requirement validation to capabilities. Enable safe evolution of capability contracts across plugin ecosystem — the system becomes a governed extension platform.

**Architecture:** `CapabilityGovernanceRegistry` extends `CapabilityRegistry` with versioned contracts. `VersionResolver` uses semver to check handler compatibility. `RequirementValidator` ensures modules declare and satisfy capability dependencies. `DeprecationChecker` warns on deprecated contracts and blocks post-sunset. Container validates all requirements during build.

**Tech Stack:** TypeScript, Jest, semver 7.x, Zod (optional schema validation), Pino logger

**Spec Reference:** `docs/architecture/erp-platform-full-spec.md` Part E

**Prerequisite:** Phase 9 (Capability System) complete — `CapabilityRegistry`, `CapabilityExecutor`, `ConflictDetector`, pricing pipeline working

---

## Assumed State

| Component | Exists? | Notes |
|-----------|---------|-------|
| `Capability` interface | ✅ | Phase 9 — `name`, `type`, `stages?` |
| `CapabilityHandler` interface | ✅ | Phase 9 — `capability`, `stage?`, `handle` |
| `CapabilityContext` interface | ✅ | Phase 9 — `input`, `state`, `result?`, `stop?` |
| `CapabilityRegistry` | ✅ | Phase 9 — register/get/clear capabilities + handlers |
| `CapabilityExecutor` | ✅ | Phase 9 — pipeline/single/composable execution |
| `validateCapabilities()` | ✅ | Phase 9 — build-time conflict detection |
| `ModuleDefinition.capabilities?` | ✅ | Phase 9 — handlers declared in module factory |
| `pricing.capability.ts` | ✅ | Phase 9 — real pipeline example |

**What Phase 10 does:** Wrap existing capability system with versioned contracts, semver compatibility, handler version support, requirement declarations, deprecation lifecycle. Extends `ModuleDefinition` with `requires?` field.

---

## Files Overview

| File | Action | Role |
|------|--------|------|
| `backend/src/core/capability-governance/types.ts` | Create | CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler |
| `backend/src/core/capability-governance/governance-registry.ts` | Create | Extends CapabilityRegistry with contracts |
| `backend/src/core/capability-governance/version-resolver.ts` | Create | Semver compatibility + requirement validation |
| `backend/src/core/capability-governance/deprecation-checker.ts` | Create | Deprecation warnings + sunset enforcement |
| `backend/src/core/capability-governance/index.ts` | Create | Barrel export |
| `backend/tests/core/capability-governance/version-resolver.test.ts` | Create | Version resolution tests |
| `backend/tests/core/capability-governance/governance-registry.test.ts` | Create | Registry tests |
| `backend/tests/core/capability-governance/deprecation-checker.test.ts` | Create | Deprecation tests |
| `backend/src/core/di/container.ts` | Modify | Add `requires?` to ModuleDefinition, validate requirements in build |
| `backend/src/main.ts` | Modify | Wire CapabilityGovernanceRegistry, register contracts |
| `backend/src/modules/product/capabilities/pricing.capability.ts` | Modify | Add contract with version |
| `backend/package.json` | Modify | Add semver + @types/semver |

---

### Task 1: Add semver Dependency

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add semver to package.json**

In `backend/package.json`, add to `dependencies`:

```json
"semver": "^7.6.0"
```

Add to `devDependencies`:

```json
"@types/semver": "^7.5.0"
```

- [ ] **Step 2: Install**

Run: `cd backend && npm install`
Expected: semver installed successfully

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add semver dependency for capability version resolution"
```

---

### Task 2: Define Governance Types

**Files:**
- Create: `backend/src/core/capability-governance/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// backend/src/core/capability-governance/types.ts
import type { z } from 'zod';
import type { CapabilityHandler } from '@core/capability/types';

interface CapabilityContract {
  name: string;                    // "pricing"
  version: string;                 // semver: "1.2.0"
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
  inputSchema?: z.ZodSchema;
  outputSchema?: z.ZodSchema;
  compatibility: {
    backwardCompatible: boolean;   // Can old handlers work with new contract?
  };
  deprecated?: boolean;
  sunsetDate?: string;             // ISO date — after this, contract is rejected at build
}

interface CapabilityRequirement {
  name: string;                    // "pricing"
  versionRange: string;            // semver range: "^1.1.0"
  mode: 'required' | 'optional';
}

interface VersionedCapabilityHandler extends CapabilityHandler {
  supportedVersion: string;        // semver range: "1.x" or "^1.0.0"
}

export type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler };
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/core/capability-governance/types.ts
git commit -m "feat: add CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler types

Governance types for versioned capability system:
- CapabilityContract: versioned with semver, compatibility flags, deprecation
- CapabilityRequirement: module declares what capabilities it needs
- VersionedCapabilityHandler: handler declares which contract version it supports"
```

---

### Task 3: Implement VersionResolver

**Files:**
- Create: `backend/src/core/capability-governance/version-resolver.ts`
- Create: `backend/tests/core/capability-governance/version-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/capability-governance/version-resolver.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  resolveHandlerCompatibility,
  validateRequirements,
} from '@core/capability-governance/version-resolver';
import type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler } from '@core/capability-governance/types';
import { CapabilityGovernanceRegistry } from '@core/capability-governance/governance-registry';

describe('resolveHandlerCompatibility', () => {
  it('should pass when handler version satisfies contract', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '1.2.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).not.toThrow();
  });

  it('should throw when handler version does not satisfy contract', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      module: 'product',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).toThrow(/incompatible/i);
  });

  it('should allow old handler on new contract when backwardCompatible is true', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).not.toThrow();
  });

  it('should reject old handler on new contract when backwardCompatible is false', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '^1.0.0',
      module: 'old-module',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).toThrow(/incompatible/i);
  });

  it('should pass when handler version exactly matches', () => {
    const contract: CapabilityContract = {
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: false },
    };

    const handler: VersionedCapabilityHandler = {
      capability: 'pricing',
      supportedVersion: '1.0.0',
      handle: async () => {},
    };

    expect(() => resolveHandlerCompatibility(contract, handler)).not.toThrow();
  });
});

describe('validateRequirements', () => {
  let registry: CapabilityGovernanceRegistry;

  beforeEach(() => {
    registry = new CapabilityGovernanceRegistry();
  });

  it('should pass when all required capabilities are satisfied', () => {
    registry.registerContract({
      name: 'pricing',
      version: '1.2.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).not.toThrow();
  });

  it('should throw when required capability is missing', () => {
    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).toThrow(/missing required/i);
  });

  it('should pass when optional capability is missing', () => {
    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'optional' },
    ];

    expect(() => validateRequirements(reqs, registry)).not.toThrow();
  });

  it('should throw when version does not satisfy range', () => {
    registry.registerContract({
      name: 'pricing',
      version: '2.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).toThrow(/does not satisfy/i);
  });

  it('should warn on deprecated capability', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    registry.registerContract({
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
      deprecated: true,
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    validateRequirements(reqs, registry);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warnSpy.mockRestore();
  });

  it('should throw when capability has passed sunset date', () => {
    registry.registerContract({
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
      deprecated: true,
      sunsetDate: '2020-01-01',
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).toThrow(/sunset/i);
  });

  it('should pass when sunset date is in the future', () => {
    registry.registerContract({
      name: 'pricing',
      version: '1.0.0',
      type: 'pipeline',
      compatibility: { backwardCompatible: true },
      deprecated: true,
      sunsetDate: '2099-12-31',
    });

    const reqs: CapabilityRequirement[] = [
      { name: 'pricing', versionRange: '^1.0.0', mode: 'required' },
    ];

    expect(() => validateRequirements(reqs, registry)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/capability-governance/version-resolver.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create VersionResolver**

```typescript
// backend/src/core/capability-governance/version-resolver.ts
import satisfies from 'semver/functions/satisfies';
import type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler } from './types';
import type { CapabilityGovernanceRegistry } from './governance-registry';

function resolveHandlerCompatibility(
  contract: CapabilityContract,
  handler: VersionedCapabilityHandler,
): void {
  if (!satisfies(contract.version, handler.supportedVersion)) {
    if (contract.compatibility.backwardCompatible) {
      // Old handler on new backward-compatible contract — allowed
      return;
    }
    throw new Error(
      `Handler ${handler.plugin ?? handler.module ?? 'unknown'} incompatible with `
      + `${contract.name}@${contract.version} (supports ${handler.supportedVersion})`,
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
      const sunsetInfo = contract.sunsetDate ? `, sunset: ${contract.sunsetDate}` : '';
      console.warn(`Capability "${req.name}" is deprecated${sunsetInfo}`);
    }

    if (contract.sunsetDate && new Date() > new Date(contract.sunsetDate)) {
      throw new Error(
        `Capability "${req.name}" has passed sunset date: ${contract.sunsetDate}`,
      );
    }
  }
}

export { resolveHandlerCompatibility, validateRequirements };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability-governance/version-resolver.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/capability-governance/version-resolver.ts backend/tests/core/capability-governance/version-resolver.test.ts
git commit -m "feat: add version resolver with semver compatibility + deprecation

- resolveHandlerCompatibility(): semver satisfaction check, backward-compatible exception
- validateRequirements(): required/optional capabilities, version range check,
  deprecation warning, sunset date enforcement"
```

---

### Task 4: Implement CapabilityGovernanceRegistry

**Files:**
- Create: `backend/src/core/capability-governance/governance-registry.ts`
- Create: `backend/tests/core/capability-governance/governance-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/capability-governance/governance-registry.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { CapabilityGovernanceRegistry } from '@core/capability-governance/governance-registry';
import type { CapabilityContract, VersionedCapabilityHandler } from '@core/capability-governance/types';

describe('CapabilityGovernanceRegistry', () => {
  let registry: CapabilityGovernanceRegistry;

  beforeEach(() => {
    registry = new CapabilityGovernanceRegistry();
  });

  describe('registerContract()', () => {
    it('should register a versioned contract', () => {
      const contract: CapabilityContract = {
        name: 'pricing',
        version: '1.2.0',
        type: 'pipeline',
        stages: ['base', 'discount', 'tax'],
        compatibility: { backwardCompatible: true },
      };

      registry.registerContract(contract);

      expect(registry.getContract('pricing')).toEqual(contract);
    });

    it('should also register as capability (inherited)', () => {
      registry.registerContract({
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        stages: ['base', 'tax'],
        compatibility: { backwardCompatible: true },
      });

      const cap = registry.getCapability('pricing');
      expect(cap?.name).toBe('pricing');
      expect(cap?.type).toBe('pipeline');
      expect(cap?.stages).toEqual(['base', 'tax']);
    });
  });

  describe('registerVersionedHandler()', () => {
    it('should register handler when version is compatible', () => {
      registry.registerContract({
        name: 'pricing',
        version: '1.2.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
      });

      const handler: VersionedCapabilityHandler = {
        capability: 'pricing',
        stage: 'base',
        supportedVersion: '^1.0.0',
        handle: async () => {},
      };

      registry.registerVersionedHandler(handler);

      expect(registry.getHandlers('pricing')).toHaveLength(1);
    });

    it('should throw when handler version is incompatible', () => {
      registry.registerContract({
        name: 'pricing',
        version: '2.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: false },
      });

      const handler: VersionedCapabilityHandler = {
        capability: 'pricing',
        supportedVersion: '^1.0.0',
        handle: async () => {},
      };

      expect(() => registry.registerVersionedHandler(handler)).toThrow(/incompatible/i);
    });

    it('should allow handler without contract (no version check)', () => {
      const handler: VersionedCapabilityHandler = {
        capability: 'pricing',
        supportedVersion: '^1.0.0',
        handle: async () => {},
      };

      registry.registerVersionedHandler(handler);

      expect(registry.getHandlers('pricing')).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/capability-governance/governance-registry.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create CapabilityGovernanceRegistry**

```typescript
// backend/src/core/capability-governance/governance-registry.ts
import { CapabilityRegistry } from '@core/capability/capability-registry';
import type { CapabilityContract, VersionedCapabilityHandler } from './types';
import { resolveHandlerCompatibility } from './version-resolver';

class CapabilityGovernanceRegistry extends CapabilityRegistry {
  private contracts = new Map<string, CapabilityContract>();

  registerContract(contract: CapabilityContract): void {
    this.contracts.set(contract.name, contract);

    // Also register as capability (inherited from CapabilityRegistry)
    this.registerCapability({
      name: contract.name,
      type: contract.type,
      stages: contract.stages,
    });
  }

  getContract(name: string): CapabilityContract | undefined {
    return this.contracts.get(name);
  }

  getAllContracts(): CapabilityContract[] {
    return [...this.contracts.values()];
  }

  registerVersionedHandler(handler: VersionedCapabilityHandler): void {
    const contract = this.contracts.get(handler.capability);

    if (contract) {
      resolveHandlerCompatibility(contract, handler);
    }

    // Register as regular handler (inherited)
    this.registerHandler(handler);
  }

  override clear(): void {
    this.contracts.clear();
    super.clear();
  }
}

export { CapabilityGovernanceRegistry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability-governance/governance-registry.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/capability-governance/governance-registry.ts backend/tests/core/capability-governance/governance-registry.test.ts
git commit -m "feat: add CapabilityGovernanceRegistry extending CapabilityRegistry

- registerContract(): stores versioned contract + registers as capability
- registerVersionedHandler(): checks semver compatibility before registering
- getContract()/getAllContracts(): lookup by name
- Extends CapabilityRegistry — inherits all handler management"
```

---

### Task 5: Implement DeprecationChecker

**Files:**
- Create: `backend/src/core/capability-governance/deprecation-checker.ts`
- Create: `backend/tests/core/capability-governance/deprecation-checker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// backend/tests/core/capability-governance/deprecation-checker.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { checkDeprecations } from '@core/capability-governance/deprecation-checker';
import type { CapabilityContract } from '@core/capability-governance/types';

describe('checkDeprecations', () => {
  it('should not warn for non-deprecated contracts', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
      },
    ];

    checkDeprecations(contracts);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should warn for deprecated contracts', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
        deprecated: true,
      },
    ];

    checkDeprecations(contracts);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warnSpy.mockRestore();
  });

  it('should include sunset date in warning', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
        deprecated: true,
        sunsetDate: '2027-01-01',
      },
    ];

    checkDeprecations(contracts);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2027-01-01'));
    warnSpy.mockRestore();
  });

  it('should throw for contracts past sunset date', () => {
    const contracts: CapabilityContract[] = [
      {
        name: 'old-capability',
        version: '1.0.0',
        type: 'single',
        compatibility: { backwardCompatible: true },
        deprecated: true,
        sunsetDate: '2020-01-01',
      },
    ];

    expect(() => checkDeprecations(contracts)).toThrow(/sunset/i);
  });

  it('should not throw for contracts with future sunset date', () => {
    const contracts: CapabilityContract[] = [
      {
        name: 'pricing',
        version: '1.0.0',
        type: 'pipeline',
        compatibility: { backwardCompatible: true },
        deprecated: true,
        sunsetDate: '2099-12-31',
      },
    ];

    expect(() => checkDeprecations(contracts)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/core/capability-governance/deprecation-checker.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create DeprecationChecker**

```typescript
// backend/src/core/capability-governance/deprecation-checker.ts
import type { CapabilityContract } from './types';

function checkDeprecations(contracts: CapabilityContract[]): void {
  const now = new Date();

  for (const contract of contracts) {
    if (!contract.deprecated) continue;

    const sunsetInfo = contract.sunsetDate ? `, sunset: ${contract.sunsetDate}` : '';
    console.warn(`Capability "${contract.name}@${contract.version}" is deprecated${sunsetInfo}`);

    if (contract.sunsetDate && now > new Date(contract.sunsetDate)) {
      throw new Error(
        `Capability "${contract.name}@${contract.version}" has passed sunset date: ${contract.sunsetDate}. `
        + 'Remove all dependencies on this capability before proceeding.',
      );
    }
  }
}

export { checkDeprecations };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/core/capability-governance/deprecation-checker.test.ts -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/core/capability-governance/deprecation-checker.ts backend/tests/core/capability-governance/deprecation-checker.test.ts
git commit -m "feat: add deprecation checker with sunset enforcement

- Warns on deprecated capabilities at build time
- Throws when capability has passed sunset date
- Includes sunset date in warning message"
```

---

### Task 6: Create Barrel Export + Update Container

**Files:**
- Create: `backend/src/core/capability-governance/index.ts`
- Modify: `backend/src/core/di/container.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// backend/src/core/capability-governance/index.ts
export { CapabilityGovernanceRegistry } from './governance-registry';
export { resolveHandlerCompatibility, validateRequirements } from './version-resolver';
export { checkDeprecations } from './deprecation-checker';
export type { CapabilityContract, CapabilityRequirement, VersionedCapabilityHandler } from './types';
```

- [ ] **Step 2: Add `requires?` to ModuleDefinition in container.ts**

Update `ModuleDefinition` in `backend/src/core/di/container.ts`:

```typescript
interface ModuleDefinition {
  module: IModule;
  providers: ProviderRegistration[];
  exports?: string[];
  hooks?: HookRegistration[];
  capabilities?: CapabilityHandlerStub[];
  requires?: CapabilityRequirementStub[];  // NEW
}
```

Add stub type:

```typescript
interface CapabilityRequirementStub {
  name: string;
  versionRange: string;
  mode: 'required' | 'optional';
}
```

Add `pendingRequirements` field:

```typescript
private pendingRequirements: CapabilityRequirementStub[] = [];
```

In `build()` — store requirements from ModuleDefinition:

```typescript
// Store requirements from ModuleDefinition
if (def.requires) {
  this.pendingRequirements.push(...def.requires);
}
```

After capability handler registration — validate requirements:

```typescript
// Validate capability requirements for all modules
if (this.pendingRequirements.length > 0) {
  const governanceRegistry = this.coreInstances.get('CapabilityGovernanceRegistry')
    as import('@core/capability-governance/governance-registry').CapabilityGovernanceRegistry | undefined;
  if (governanceRegistry) {
    const { validateRequirements } = await import('@core/capability-governance/version-resolver');
    validateRequirements(this.pendingRequirements, governanceRegistry);
  }
  this.pendingRequirements = [];
}
```

- [ ] **Step 3: Run existing tests**

Run: `cd backend && npx jest tests/core/di/container.test.ts -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/core/capability-governance/index.ts backend/src/core/di/container.ts
git commit -m "feat: add requires? field to ModuleDefinition + requirement validation

- ModuleDefinition.gains requires? for capability dependency declarations
- Container stores pendingRequirements during build
- Requirements validated after capability handlers registered
- Barrel export created for capability-governance module"
```

---

### Task 7: Update Pricing Capability with Versioned Contract

**Files:**
- Modify: `backend/src/modules/product/capabilities/pricing.capability.ts`

- [ ] **Step 1: Add versioned contract to pricing capability**

```typescript
// backend/src/modules/product/capabilities/pricing.capability.ts
import type { Capability } from '@core/capability/types';
import type { CapabilityContract, VersionedCapabilityHandler } from '@core/capability-governance/types';

const pricingContract: CapabilityContract = {
  name: 'pricing',
  version: '1.0.0',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
  compatibility: {
    backwardCompatible: true,
  },
};

const pricingCapability: Capability = {
  name: 'pricing',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
};

const basePriceHandler: VersionedCapabilityHandler = {
  capability: 'pricing',
  stage: 'base',
  priority: 10,
  module: 'product',
  supportedVersion: '^1.0.0',
  handle: async (ctx) => {
    ctx.state.basePrice = ctx.input.basePrice;
    ctx.result = ctx.input.basePrice;
  },
};

const roundingHandler: VersionedCapabilityHandler = {
  capability: 'pricing',
  stage: 'rounding',
  priority: 50,
  module: 'product',
  supportedVersion: '^1.0.0',
  handle: async (ctx) => {
    ctx.result = Math.round((ctx.result ?? 0) * 100) / 100;
  },
};

const finalPriceHandler: VersionedCapabilityHandler = {
  capability: 'pricing',
  stage: 'final',
  priority: 50,
  module: 'product',
  supportedVersion: '^1.0.0',
  handle: async (ctx) => {
    ctx.state.finalPrice = ctx.result;
  },
};

export {
  pricingContract,
  pricingCapability,
  basePriceHandler,
  roundingHandler,
  finalPriceHandler,
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/product/capabilities/pricing.capability.ts
git commit -m "feat: add versioned contract to pricing capability

- pricingContract: version 1.0.0, backwardCompatible: true
- Handlers upgraded to VersionedCapabilityHandler with supportedVersion: ^1.0.0"
```

---

### Task 8: Wire Governance in main.ts

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Replace CapabilityRegistry with CapabilityGovernanceRegistry**

In `backend/src/main.ts`, update imports and registration:

```typescript
// Replace:
// import { CapabilityRegistry, CapabilityExecutor, validateCapabilities } from '@core/capability';

// With:
import { CapabilityExecutor, validateCapabilities } from '@core/capability';
import { CapabilityGovernanceRegistry, checkDeprecations } from '@core/capability-governance';
import { pricingContract } from '@modules/product/capabilities/pricing.capability';

// Replace CapabilityRegistry registration:
container.registerCore('CapabilityGovernanceRegistry', {
  useFactory: () => new CapabilityGovernanceRegistry(),
});

// Alias for backward compat (hooks/capabilities use 'CapabilityRegistry' token):
container.registerCore('CapabilityRegistry', {
  useFactory: () => container.get('CapabilityGovernanceRegistry'),
});

container.registerCore('CapabilityExecutor', {
  useFactory: () => new CapabilityExecutor(
    container.get('CapabilityGovernanceRegistry'),
    logger,
  ),
  deps: ['CapabilityGovernanceRegistry'],
});
```

- [ ] **Step 2: Register contracts + run deprecation check after build**

After `await container.build(registry.getActive())`:

```typescript
// Register capability contracts
const governanceRegistry = container.get<CapabilityGovernanceRegistry>('CapabilityGovernanceRegistry');
governanceRegistry.registerContract(pricingContract);

// Validate capabilities
validateCapabilities(governanceRegistry);

// Check deprecations
checkDeprecations(governanceRegistry.getAllContracts());
```

- [ ] **Step 3: Run full test suite**

Run: `cd backend && npx jest --passWithNoTests -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire CapabilityGovernanceRegistry + contract registration in main.ts

- CapabilityGovernanceRegistry replaces CapabilityRegistry as primary
- Pricing contract registered with version 1.0.0
- validateCapabilities() + checkDeprecations() run after build
- Alias 'CapabilityRegistry' token for backward compatibility"
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

- [ ] `CapabilityContract` has `name`, `version`, `type`, `compatibility`, `deprecated?`, `sunsetDate?`
- [ ] `CapabilityRequirement` has `name`, `versionRange`, `mode`
- [ ] `VersionedCapabilityHandler` extends `CapabilityHandler` with `supportedVersion`
- [ ] `resolveHandlerCompatibility()` passes when semver satisfied
- [ ] `resolveHandlerCompatibility()` throws when incompatible + backwardCompatible=false
- [ ] `resolveHandlerCompatibility()` passes when incompatible + backwardCompatible=true
- [ ] `validateRequirements()` throws on missing required capability
- [ ] `validateRequirements()` passes on missing optional capability
- [ ] `validateRequirements()` throws on version range mismatch
- [ ] `validateRequirements()` warns on deprecated capability
- [ ] `validateRequirements()` throws on post-sunset capability
- [ ] `CapabilityGovernanceRegistry.registerContract()` stores contract + registers capability
- [ ] `CapabilityGovernanceRegistry.registerVersionedHandler()` checks compatibility
- [ ] `checkDeprecations()` warns on deprecated, throws on sunset
- [ ] `ModuleDefinition` has `requires?` field
- [ ] Container `build()` validates requirements
- [ ] `pricing.capability.ts` has `pricingContract` with version `1.0.0`
- [ ] `main.ts` uses `CapabilityGovernanceRegistry`
- [ ] `main.ts` registers `pricingContract`
- [ ] `main.ts` runs `checkDeprecations()` after build

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 10 validation — Capability Governance all checks pass"
```

---

## Self-Review

**Spec coverage (Part E of erp-platform-full-spec.md):**
- ✅ E.1 CapabilityContract → Task 2
- ✅ E.2 CapabilityRequirement → Task 2
- ✅ E.3 VersionedCapabilityHandler → Task 2
- ✅ E.4 Version Resolution → Task 3
- ✅ E.5 CapabilityGovernanceRegistry → Task 4
- ✅ E.6 Conflict Matrix → Task 5 (deprecation)
- ✅ E.7 ModuleFactory Integration → Task 6
- ✅ E.8 Container Build Flow → Task 6
- ✅ E.9 Observability → Task 8 (metrics from Phase 1)
- ✅ E.10 semver dependency → Task 1
- ✅ Pricing contract example → Task 7

**Placeholder scan:** No TBD, TODO, or "implement later" found.

**Type consistency:** `CapabilityContract`, `CapabilityRequirement`, `VersionedCapabilityHandler` defined in Task 2, used consistently in Tasks 3–8.
