# AI Agent Guide: Module vs Plugin Decision (Revised)

## Purpose

Guide AI agents to classify new features as:

* **Module (Core Domain)**
* **Optional Module (Toggleable Domain)**
* **Plugin (Extension)**

Architecture: **Domain-driven Modular Core with Plugin-based Extensions**

---

# 1. Correct Core Principle

> **Core defines architecture rules and runtime. Modules define business domain. Plugins extend behavior.**

* Core = infrastructure + enforcement (NO domain knowledge)
* Modules = domain ownership
* Plugins = optional extensions

---

# 2. Decision Tree (MANDATORY)

## Step 1 — Does it introduce NEW DOMAIN DATA?

* YES → Step 2
* NO → Step 5

## Step 2 — Does it have its OWN lifecycle?

(create/update/delete, state, validation)

* YES → Step 3
* NO → Plugin

## Step 3 — Does it enforce BUSINESS INVARIANTS?

(unique rules, constraints, consistency)

* YES → Step 4
* NO → Plugin

## Step 4 — Is it REQUIRED in most deployments?

* YES → **Module (Core Domain)**
* NO → **Optional Module**

## Step 5 — Does it MODIFY existing behavior?

(pricing, workflow, UI enhancement)

* YES → Plugin
* NO → Step 6

## Step 6 — Does it ONLY react to events?

* YES → Plugin
* NO → Plugin

---

# 3. Classification Rules

## A. MODULE (Core Domain)

Use when:

* Defines core business entities
* Required for system identity
* Enforces critical invariants

Must:

* Own database schema
* Emit domain events
* Expose service interfaces

Must NOT:

* Depend on plugins
* Leak domain into core

---

## B. OPTIONAL MODULE

Use when:

* Real domain (data + lifecycle + invariants)
* Not required in all deployments
* Can be enabled/disabled

Must:

* Own its own tables
* Emit its own domain events
* Integrate via service contracts/events

---

## C. PLUGIN

Use when:

* Extends or modifies behavior
* Adds optional features
* Not core domain

Must:

* Use service interfaces only
* Subscribe to events OR use hooks
* Use isolated storage (`plugin_{name}_*`)

Must NOT:

* Access module DB directly
* Emit core domain events
* Modify module schema

---

# 4. Anti-Patterns (AUTO-REJECT)

## ❌ Fake Modules

Splitting same aggregate:

* product
* product-variant
* product-price
  → REJECT

## ❌ Fat Core

Putting domain into core
→ REJECT

## ❌ Plugin Owning Domain

Plugin with invariants + critical data
→ REJECT (must be module)

## ❌ Cross-module DB Access

→ REJECT

---

# 5. Heuristics (Quick Decision)

### MODULE

* Defines WHAT system IS
* Removing breaks system

### OPTIONAL MODULE

* Domain feature but not always needed

### PLUGIN

* Defines HOW system BEHAVES
* Replaceable / multiple implementations

---

# 6. Examples

## Product Variant

* Lifecycle: YES
* Invariants: YES
* Optional: YES
  → OPTIONAL MODULE

## Pricing Rules

* No domain ownership
* Behavior modification
  → PLUGIN

## Inventory

* Strong domain
  → MODULE or OPTIONAL MODULE

---

# 7. Enforcement Rules for Agent

Agent MUST:

* Run decision tree
* Justify classification
* Reject invalid designs

Agent MUST NOT:

* Put domain in core
* Split same aggregate into multiple modules
* Allow plugin DB access to module

---

# 8. Output Format (MANDATORY)

```
Feature: <name>
Classification: Module | Optional Module | Plugin
Reasoning:
- ...

Data Ownership:
- ...

Extension Mechanism:
- ...
```

---

# 9. Golden Rule

> If it defines WHAT the system IS → Module
> If it defines HOW the system BEHAVES → Plugin

---

# END
