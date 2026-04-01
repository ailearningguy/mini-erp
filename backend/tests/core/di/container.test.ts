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
});
