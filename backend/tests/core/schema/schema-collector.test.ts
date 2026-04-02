import { describe, it, expect, beforeEach } from '@jest/globals';
import { SchemaCollector } from '@core/schema/schema-collector';

describe('SchemaCollector', () => {
  let collector: SchemaCollector;

  beforeEach(() => {
    collector = new SchemaCollector();
  });

  it('should collect schemas from multiple sources', () => {
    const products = { tableName: 'products' } as any;
    const orders = { tableName: 'orders' } as any;

    collector.collect({ products }, 'module:product');
    collector.collect({ orders }, 'module:order');

    const all = collector.getAll();
    expect(all).toHaveProperty('products');
    expect(all).toHaveProperty('orders');
  });

  it('should throw on duplicate table name', () => {
    const schema = { tableName: 'products' } as any;

    collector.collect({ products: schema }, 'module:product');

    expect(() => collector.collect({ products: schema }, 'module:other')).toThrow(/already registered/);
  });

  it('should include source in duplicate error message', () => {
    const schema = { tableName: 'x' } as any;

    collector.collect({ x: schema }, 'module:product');

    expect(() => collector.collect({ x: schema }, 'plugin:analytics')).toThrow(/Original source.*Duplicate from source/);
  });

  it('should return empty object when no schemas collected', () => {
    expect(collector.getAll()).toEqual({});
  });

  it('should return copy of schemas (not reference)', () => {
    collector.collect({ products: {} as any }, 'module:product');

    const all1 = collector.getAll();
    const all2 = collector.getAll();
    expect(all1).not.toBe(all2);
    expect(all1).toEqual(all2);
  });

  it('should clear all schemas', () => {
    collector.collect({ products: {} as any }, 'module:product');
    collector.clear();

    expect(collector.getAll()).toEqual({});
  });

  it('should allow re-collect after clear', () => {
    collector.collect({ products: {} as any }, 'module:product');
    collector.clear();
    collector.collect({ products: {} as any }, 'module:product');

    expect(collector.getAll()).toHaveProperty('products');
  });

  it('should collect multiple schemas from one source', () => {
    const products = {} as any;
    const productVariants = {} as any;

    collector.collect({ products, product_variants: productVariants }, 'module:product');

    const all = collector.getAll();
    expect(all).toHaveProperty('products');
    expect(all).toHaveProperty('product_variants');
  });
});