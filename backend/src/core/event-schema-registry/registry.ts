import { z } from 'zod';
import type { EventEnvelope } from '@shared/types/event';

class EventSchemaRegistry {
  private schemas = new Map<string, z.ZodSchema>();

  register<T>(eventType: string, schema: z.ZodSchema<T>): void {
    if (this.schemas.has(eventType)) {
      throw new Error(`Schema already registered for event type: ${eventType}`);
    }
    this.schemas.set(eventType, schema);
  }

  validate(eventType: string, data: unknown): EventEnvelope {
    const schema = this.schemas.get(eventType);
    if (!schema) {
      throw new Error(`No schema registered for event type: ${eventType}. `
        + 'All events MUST have a registered schema before publishing (ADR-008).');
    }
    return schema.parse(data) as EventEnvelope;
  }

  hasSchema(eventType: string): boolean {
    return this.schemas.has(eventType);
  }

  getRegisteredTypes(): string[] {
    return [...this.schemas.keys()];
  }
}

export { EventSchemaRegistry };
