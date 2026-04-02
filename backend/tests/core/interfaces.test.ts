import { describe, it, expect } from '@jest/globals';

describe('Core interfaces', () => {
  it('should have IEventBus interface file', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const interfacePath = path.resolve(__dirname, '../../src/core/event-bus/event-bus.interface.ts');
    expect(fs.existsSync(interfacePath)).toBe(true);
  });

  it('IEventBus should have emit method', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/event-bus/event-bus.interface.ts'),
      'utf-8',
    );
    expect(content).toMatch(/emit\s*[<(]/);
    expect(content).toContain('interface IEventBus');
  });

  it('EventBus class should implement IEventBus', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/event-bus/event-bus.ts'),
      'utf-8',
    );
    expect(content).toContain('implements IEventBus');
  });

  it('should have ISagaOrchestrator interface file', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const interfacePath = path.resolve(__dirname, '../../src/core/saga/saga-orchestrator.interface.ts');
    expect(fs.existsSync(interfacePath)).toBe(true);
  });

  it('ISagaOrchestrator should have startSaga method', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/saga/saga-orchestrator.interface.ts'),
      'utf-8',
    );
    expect(content).toMatch(/startSaga\s*[<(]/);
    expect(content).toContain('interface ISagaOrchestrator');
  });

  it('should have ICacheService interface file', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    expect(fs.existsSync(path.resolve(__dirname, '../../src/core/cache/cache-service.interface.ts'))).toBe(true);
  });

  it('should have IHookExecutor interface file', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    expect(fs.existsSync(path.resolve(__dirname, '../../src/core/hooks/hook-executor.interface.ts'))).toBe(true);
  });

  it('should not have any type in capability types', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/capability/types.ts'),
      'utf-8',
    );
    const anyMatches = content.match(/:\s*any\b/g);
    expect(anyMatches).toBeNull();
  });

  it('should not have any type in hooks types', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/core/hooks/types.ts'),
      'utf-8',
    );
    const anyMatches = content.match(/:\s*any\b/g);
    expect(anyMatches).toBeNull();
  });

  it('product.service.ts should import IEventBus not EventBus', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/modules/product/product.service.ts'),
      'utf-8',
    );
    expect(content).toContain("import type { IEventBus }");
  });

  it('order.service.ts should import interfaces not concrete classes', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/modules/order/order.service.ts'),
      'utf-8',
    );
    expect(content).toContain("import type { IEventBus }");
    expect(content).toContain("import type { ISagaOrchestrator }");
  });

  it('inventory.service.ts should import IEventBus not EventBus', () => {
    const content = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../src/modules/inventory/inventory.service.ts'),
      'utf-8',
    );
    expect(content).toContain("import type { IEventBus }");
  });
});
