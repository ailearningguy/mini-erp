import type { RateLimitConfig } from '@core/consumer/rate-limiter';
import type { Db } from '@shared/types/db';
import type { EventEnvelope } from '@shared/types/event';

type EventHandler = (event: EventEnvelope, tx: Db) => Promise<void>;

interface EventHandlerRegistration {
  eventType: string;
  handler: EventHandler;
  moduleName: string;
}

interface ActiveModule {
  name: string;
  version: string;
  enabled: boolean;
  dependencies: string[];
}

class ModuleRegistry {
  private rateLimits: RateLimitConfig[] = [];
  private eventHandlers: EventHandlerRegistration[] = [];
  private activeModules: ActiveModule[] = [];

  registerRateLimits(_moduleName: string, configs: RateLimitConfig[]): void {
    for (const cfg of configs) {
      if (this.rateLimits.some((r) => r.eventType === cfg.eventType)) {
        throw new Error(`Rate limit already registered for event type: ${cfg.eventType}`);
      }
    }
    this.rateLimits.push(...configs);
  }

  getAllRateLimits(): RateLimitConfig[] {
    return [...this.rateLimits];
  }

  registerEventHandler(moduleName: string, eventType: string, handler: EventHandler): void {
    this.eventHandlers.push({ eventType, handler, moduleName });
  }

  getEventHandlers(): EventHandlerRegistration[] {
    return [...this.eventHandlers];
  }

  setActiveModules(modules: ActiveModule[]): void {
    this.activeModules = modules;
  }

  getActive(): ActiveModule[] {
    return this.activeModules.filter((m) => m.enabled);
  }

  getByName(name: string): ActiveModule | undefined {
    return this.activeModules.find((m) => m.name === name);
  }
}

export { ModuleRegistry };
export type { EventHandlerRegistration, ActiveModule };