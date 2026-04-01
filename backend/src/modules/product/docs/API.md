# Product API

## Endpoints

### GET /api/v1/products
List products with cursor pagination.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int | 20 | 1-100 |
| `cursor` | UUID | - | Pagination cursor |

### POST /api/v1/products
Create a new product.

**Body:** `{ product_name, sku, base_price, stock }`

### GET /api/v1/products/:id
Get product by ID.

### PUT /api/v1/products/:id
Update product (requires `version` for optimistic locking).

**Body:** `{ version, product_name?, base_price?, stock? }`

### DELETE /api/v1/products/:id
Soft-delete product. Emits `product.deactivated.v1`. Returns 204.
