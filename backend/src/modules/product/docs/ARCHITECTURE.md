# Product Architecture

## Data Flow
```
Client -> Controller -> Service -> Drizzle Schema -> PostgreSQL
                                |
                           EventBus.emit() -> Outbox (same tx)
```

## Key Decisions
- **Optimistic Locking:** Version checked inside DB transaction (prevents TOCTOU)
- **Soft Delete:** `isActive: false` instead of DELETE
- **Event Naming:** `product.deactivated.v1` for soft delete (not `deleted`)
- **Naming Convention:** camelCase in TS, snake_case in DB columns (explicit mapping)

## Events
| Event | Trigger | Payload |
|-------|---------|---------|
| `product.created.v1` | New product | `{ productId, productName, sku, basePrice, stock }` |
| `product.updated.v1` | Product updated | `{ productId, changes, previousVersion }` |
| `product.deactivated.v1` | Soft delete | `{ productId, productName, sku }` |
