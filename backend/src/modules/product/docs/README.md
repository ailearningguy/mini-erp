# Product Module

## Overview
Core product management with CRUD operations, optimistic locking, and event sourcing via Outbox pattern.

## Features
- Create products with SKU uniqueness check
- List with cursor-based pagination
- Update with optimistic locking (version field)
- Soft delete (deactivate)
- Domain events: `product.created.v1`, `product.updated.v1`, `product.deactivated.v1`

## Quick Start
```typescript
const service = new ProductService(db, eventBus);
const product = await service.create({
  productName: 'Widget',
  sku: 'WDG-001',
  basePrice: 9.99,
  stock: 100,
});
```

## API Reference
See [API.md](./API.md)

## Architecture
See [ARCHITECTURE.md](./ARCHITECTURE.md)
