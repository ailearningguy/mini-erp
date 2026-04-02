# 2. PLUGIN_COMPLIANCE.md

## Purpose

Ensure plugins follow **Plugin-based Extensions** model safely.

---

## A. No Direct DB Access

* [ ] Plugin does NOT access module database
* [ ] Plugin does NOT inject repository

❌ Forbidden:

* ProductRepository usage

---

## B. Uses Service Interface Only

* [ ] All interactions via service contracts

---

## C. No Core Domain Event Emission

* [ ] Plugin does NOT emit domain events like product.created
* [ ] Only emits plugin-scoped events

---

## D. Extension Mechanism

* [ ] Uses one of:

  * [ ] Event subscription
  * [ ] Hook system
  * [ ] Service wrapping

---

## E. Isolated Storage

* [ ] Uses its own tables (plugin_{name}_*)
* [ ] No schema modification of modules

---

## F. UI Extension (if frontend exists)

* [ ] Registers UI via slot/registry
* [ ] Does NOT modify core UI directly
* [ ] Supports dynamic load

---

## G. Permission Declaration

* [ ] Declares required permissions
* [ ] Does not exceed declared scope

---

## H. Lifecycle Compliance

* [ ] Implements onActivate()
* [ ] Implements onDeactivate()
* [ ] Implements dispose()

---

## I. Failure Isolation

* [ ] Plugin failure does NOT crash system (handled boundary)

---

## J. Test Criteria

* [ ] Plugin can be removed without breaking system
* [ ] Plugin can be installed/uninstalled dynamically

---

## PASS CONDITION

All checks must be TRUE.

---

## FINAL RULE

"Core must stay clean. Modules must stay isolated. Plugins must stay optional."