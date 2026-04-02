# Extended Architecture: Soft Restart & Optional Module Support (Detailed)

## Purpose

Provide production-grade guidance to extend Architecture v2.2 fileciteturn1file0 with:

* Optional Module install/uninstall
* Application-level **Soft Restart**
* Hybrid model (Module + Plugin coexistence)

This document is **additive** (no breaking change to ADR-001 → ADR-009).

---

# 0. Definitions

* **Soft Restart**: Rebuild application state (DI graph + module bindings) **without OS process restart**.
* **Optional Module**: Domain module (owns data, invariants) that can be enabled/disabled per deployment.
* **Plugin**: Behavior extension (no domain ownership), dynamic at runtime.

---

# 1. Non-Goals

* No dynamic schema registry (keep explicit schema aggregation)
* No weakening of DI validation / fail-fast
* No change to Outbox/Event architecture

---

# 2. New Components (Required)

## 2.1 Module Registry

### Responsibility

* Discover modules (FS/DB)
* Resolve dependency graph (topological sort)
* Provide active module set for container build

### Interfaces

```ts
interface ModuleMetadata {
  name: string;
  version: string;            // date-based
  enabled: boolean;
  dependencies?: { name: string; version: string }[];
  entry: () => Promise<IModuleFactory>; // lazy loader
}

interface ModuleRegistry {
  scan(): Promise<ModuleMetadata[]>;                // discover
  resolve(mods: ModuleMetadata[]): ModuleMetadata[];// topo sort + version check
  getActive(): ModuleMetadata[];                    // cached snapshot
  refresh(): Promise<ModuleMetadata[]>;             // re-scan + resolve
}
```

### Rules

* MUST fail-fast on circular deps / version mismatch
* MUST be deterministic (same input → same order)
* MUST NOT load code eagerly during scan (use `entry` lazy)

---

## 2.2 Resettable DI Container

### Responsibility

* Build, validate, and **rebuild** DI graph
* Manage lifecycle of modules/services

### Interfaces

```ts
interface ResettableContainer {
  build(mods: ModuleMetadata[]): Promise<void>;
  dispose(): Promise<void>;           // full teardown
  rebuild(mods: ModuleMetadata[]): Promise<void>; // dispose + build
  get<T>(token: Token<T>): T;         // runtime resolve
}
```

### Build Pipeline (MUST follow order)

```
1. Load module factories (lazy import)
2. Collect providers (tokens)
3. Register providers
4. Validate graph (no cycles, contracts ok)
5. Instantiate singletons
6. Bind event handlers / hooks
7. Call module.onInit()
```

### Dispose Pipeline

```
1. Call module.onDestroy() (reverse topo order)
2. Unsubscribe event handlers
3. Stop background jobs (BullMQ)
4. Close resources (timers, sockets owned by modules)
5. Clear singleton cache
```

### Rules

* dispose MUST be **idempotent**
* build MUST be **fail-fast** (throw on any violation)
* No partial success (all-or-nothing)

---

## 2.3 Module Lifecycle

```ts
interface IModule {
  onInit(): Promise<void>;     // register handlers, warm caches (optional)
  onDestroy(): Promise<void>;  // unregister handlers, stop jobs
}
```

### Rules

* onInit MUST NOT perform long blocking IO (> few seconds)
* onDestroy MUST NOT throw (log + continue)

---

## 2.4 Traffic Control

### Components

```ts
class TrafficGate {
  private state: 'OPEN'|'PAUSED' = 'OPEN';
  middleware(req,res,next){
    if (this.state === 'PAUSED') return res.status(503).json({ error: { code: 'MAINTENANCE', message: 'System updating' }});
    next();
  }
  pause(){ this.state='PAUSED'; }
  resume(){ this.state='OPEN'; }
}

class RequestTracker {
  private active = 0;
  start(){ this.active++; }
  end(){ this.active--; }
  async drain(timeoutMs=5000){
    const start = Date.now();
    while (this.active>0 && Date.now()-start<timeoutMs) await new Promise(r=>setTimeout(r,25));
  }
}
```

### Rules

* MUST be installed globally (before all routes)
* MUST wrap request lifecycle (start/end)

---

## 2.5 System State

```ts
enum SystemState { RUNNING, RESTARTING, MAINTENANCE }
```

* Exposed via `/health` and metrics
* UI can poll to display maintenance banner

---

## 2.6 Soft Restart Manager

```ts
class SoftRestartManager {
  constructor(
    private gate: TrafficGate,
    private tracker: RequestTracker,
    private registry: ModuleRegistry,
    private container: ResettableContainer,
    private logger: Logger,
  ){}

  async restart(reason: string){
    this.logger.info({reason}, 'soft-restart:start');
    this.gate.pause();
    await this.tracker.drain(5000);

    const snapshotBefore = this.registry.getActive();

    try {
      const mods = await this.registry.refresh();
      await this.container.rebuild(mods);
      this.logger.info({mods: mods.map(m=>m.name)}, 'soft-restart:success');
    } catch (err) {
      this.logger.error({err}, 'soft-restart:failed');
      // rollback: rebuild previous snapshot
      await this.container.rebuild(snapshotBefore);
      throw err;
    } finally {
      this.gate.resume();
    }
  }
}
```

### Guarantees

* No new requests during rebuild
* In-flight requests complete (best-effort with timeout)
* Rollback to previous container on failure

---

## 2.7 Module Installer

```ts
class ModuleInstaller {
  constructor(
    private migrations: MigrationRunner,
    private restart: SoftRestartManager,
    private registry: ModuleRegistry,
  ){}

  async install(name: string){
    await this.migrations.up(name); // must be backward-compatible
    await this.restart.restart('install:'+name);
  }

  async uninstall(name: string){
    // optional: run DOWN migrations if safe
    await this.restart.restart('uninstall:'+name);
  }
}
```

### Rules

* Migration MUST complete before restart
* Migrations MUST follow zero-downtime rules (Section 5 of v2.2)

---

# 3. End-to-End Flow

## Install Optional Module

```
UI → POST /modules/install
  → validate manifest + permissions
  → run UP migrations
  → SoftRestartManager.restart()
    → pause traffic
    → drain in-flight
    → rebuild container (new module included)
    → resume traffic
```

## Uninstall

```
UI → POST /modules/uninstall
  → (optional) DOWN migrations (if safe)
  → restart
```

---

# 4. Event & Job Safety During Restart

* **RabbitMQ consumers**: pause consumption during restart window
* **BullMQ workers**: pause queues, resume after rebuild
* **Idempotency** ensures safe re-delivery (Section 11 v2.2)

```ts
await bullQueue.pause();
await rabbitConsumer.pause();
// restart
await rabbitConsumer.resume();
await bullQueue.resume();
```

---

# 5. Multi-Instance (Production)

## Recommended: Blue/Green (v2.1 Section 32.5)

* Build new version (with module)
* Switch traffic atomically

## Alternative: Rolling Restart

* Restart instances one-by-one
* Shared Redis/RabbitMQ ensure continuity

---

# 6. Failure Scenarios & Handling

| Scenario          | Handling                            |
| ----------------- | ----------------------------------- |
| Build fails       | rollback to previous snapshot       |
| Timeout draining  | proceed after timeout (best-effort) |
| Migration fails   | abort, no restart                   |
| Event duplication | handled by idempotency store        |

---

# 7. Observability

### Metrics

```
system_restart_total
system_restart_duration_seconds
system_restart_failed_total
system_state
```

### Logs

* soft-restart:start
* soft-restart:success
* soft-restart:failed

---

# 8. Security & Governance

* Only **trusted operators** can install modules
* Validate plugin/module permissions (reuse PluginGuard)
* Audit log for install/uninstall actions

---

# 9. Anti-Patterns (Reject)

* Hot-reload module without DI rebuild
* Partial container rebuild
* Installing module without migration
* Allowing requests during rebuild

---

# 10. Checklist

## Minimum

* [ ] ModuleRegistry
* [ ] ResettableContainer
* [ ] TrafficGate + RequestTracker
* [ ] SoftRestartManager

## Production

* [ ] ModuleInstaller
* [ ] Worker pause/resume
* [ ] Observability
* [ ] Rollback mechanism

---

# 11. Key Insight

Soft restart = **re-execute startup pipeline safely at runtime**

Maintains:

* Fail-fast
* Strong contracts
* Isolation

Without sacrificing:

* Operational flexibility

---

# END
