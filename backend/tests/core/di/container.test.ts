import { describe, it, expect, beforeEach } from '@jest/globals';
import { DIContainer } from '@core/di/container';

describe('DIContainer', () => {
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  it('should register and resolve a singleton service', () => {
    container.register('MyService', () => ({ name: 'test' }));
    const a = container.resolve('MyService');
    const b = container.resolve('MyService');
    expect(a).toBe(b);
  });

  it('should throw on duplicate registration', () => {
    container.register('MyService', () => ({}));
    expect(() => container.register('MyService', () => ({}))).toThrow('already registered');
  });

  it('should throw on unregistered resolution', () => {
    expect(() => container.resolve('Unknown')).toThrow('not registered');
  });

  it('should detect circular dependencies', () => {
    container.register('A', () => container.resolve('B'));
    container.register('B', () => container.resolve('A'));
    expect(() => container.resolve('A')).toThrow('Circular dependency');
  });

  it('should return registered tokens', () => {
    container.register('A', () => ({}));
    container.register('B', () => ({}));
    expect(container.getRegisteredTokens()).toEqual(['A', 'B']);
  });

  describe('validateGraph', () => {
    it('should detect cycles via deps array without calling factories', () => {
      container.register('A', () => ({}), ['B']);
      container.register('B', () => ({}), ['A']);
      expect(() => container.validateGraph()).toThrow('Circular');
    });

    it('should detect missing dependencies', () => {
      container.register('A', () => ({}), ['Missing']);
      expect(() => container.validateGraph()).toThrow('Missing');
    });

    it('should pass when deps are all registered', () => {
      container.register('A', () => ({}), ['B']);
      container.register('B', () => ({}));
      expect(() => container.validateGraph()).not.toThrow();
    });
  });

  describe('plugin restriction', () => {
    it('should allow core to register any token', () => {
      container.setActor('core');
      expect(() => container.register('ProductRepository', () => ({}))).not.toThrow();
    });

    it('should block plugin from registering repository tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('ProductRepository', () => ({}))).toThrow(
        /cannot register.*repository/i,
      );
    });

    it('should block plugin from registering schema tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('Product.schema', () => ({}))).toThrow(
        /cannot register.*schema/i,
      );
    });

    it('should allow plugin to register non-restricted tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('AnalyticsService', () => ({}))).not.toThrow();
    });

    it('should allow plugin to register service interface tokens', () => {
      container.setActor('plugin:analytics');
      expect(() => container.register('IProductService', () => ({}))).not.toThrow();
    });
  });
});
