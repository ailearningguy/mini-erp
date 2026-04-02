# 1. MODULE_COMPLIANCE.md

## Purpose

Ensure every module follows **Domain-driven Modular Core** principles.

---

## A. Data Ownership

* [ ] Module owns its database tables
* [ ] No other module/plugin writes directly to its tables
* [ ] Schema defined inside module only

❌ Violation:

* Another module modifies this module's table
* Plugin alters module schema

---

## B. Domain Isolation

* [ ] No import from other modules
* [ ] No cross-module repository usage
* [ ] Communication via service interface ONLY

✅ Allowed:

* Interface-based calls

❌ Forbidden:

* Direct class import from another module
* Accessing another module's DB

---

## C. Service Contract

* [ ] Public interface defined (e.g., IProductService)
* [ ] Versioned contract
* [ ] Backward compatibility maintained

---

## D. Event Emission

* [ ] Emits domain events via EventBus
* [ ] Event schema registered and validated
* [ ] Uses transaction-bound emit

---

## E. No Plugin Awareness

* [ ] Module does NOT reference plugin
* [ ] No conditional logic for plugin behavior

❌ Violation:

* if (pluginXEnabled) { ... }

---

## F. Minimal Core Domain

* [ ] Only essential fields exist (no over-design)
* [ ] Extensions are NOT inside module schema

---

## G. Test Criteria

* [ ] Module works independently without plugins
* [ ] Removing all plugins does NOT break module

---

## PASS CONDITION

All checks must be TRUE.

---

## FINAL RULE

"Core must stay clean. Modules must stay isolated. Plugins must stay optional."