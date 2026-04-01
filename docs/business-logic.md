# BUSINESS DOMAIN SPECIFICATION

## 1. Overview

This document defines the complete business domain for a B2B commerce + ERP platform serving wholesale beverage ingredient suppliers (e.g., tea, coffee, syrup, toppings).

Scope includes:

* Product catalog and pricing
* Inventory and purchasing
* Order lifecycle and checkout
* Customer management (CRM)
* Promotion, voucher, wallet, loyalty
* Analytics, audit, and admin control

This document is architecture-agnostic and focuses purely on business logic and rules.

---

# 2. Product Domain

## 2.1 Product Structure

* A Product represents a sellable item (e.g., "Trà xanh").
* Each Product MUST have at least one Variant.

### Variant

* Represents product version (flavor/type), NOT packaging.
* Each variant has:

  * price
  * SKU (unique)
  * unit (default selling unit)

## 2.2 Unit System

* Each product has a **base unit** (e.g., chai, kg, lit).
* Additional units (pack, thùng, bao...) defined via conversion ratios.

Rules:

* 1 unit = X base units
* All inventory normalized to base unit
* Input/output can use any unit

## 2.3 Pricing

* Base price defined per variant
* PriceList overrides price based on:

  * customer group
  * minimum quantity

Resolution order:

1. Customer group price list
2. Fallback to base price

## 2.4 Batch & Expiry

* Inventory tracked per batch
* Each batch has:

  * batch number
  * expiry date
  * quantity

Rules:

* FIFO consumption (earliest expiry first)
* Expired batch:

  * allowed to sell with confirmation
* Near-expiry alerts (7/14/30 days)

## 2.5 Supplier

* Supplier provides products
* Each variant can have multiple suppliers
* One preferred supplier per variant
* Supplier includes cost price

## 2.6 Product Lifecycle

Statuses:

* DRAFT
* PUBLISHED
* DISABLED
* ARCHIVED

Rules:

* Only PUBLISHED/DISABLED visible to customers
* ARCHIVED not purchasable

---

# 3. Inventory & Purchasing Domain

## 3.1 Inventory Model

Inventory tracked by:

* product
* variant
* batch

Quantities:

* available
* reserved

## 3.2 Operations

* Reserve (when order created)
* Release (when order cancelled)
* Adjust (manual change with reason)

## 3.3 FIFO Logic

* Always consume from oldest batch first
* If insufficient:

  * continue to next batch
* If total insufficient:

  * reject operation

## 3.4 Purchasing

* Purchase Order (PO)
* PO contains items (product, quantity, cost)
* Receiving goods creates batches

## 3.5 Alerts

* Low stock alerts
* Expired / near-expiry alerts

---

# 4. Order Domain

## 4.1 Order Lifecycle

Statuses:

* PENDING
* CONFIRMED
* PROCESSING
* SHIPPING
* COMPLETED
* CANCELLED

Transitions are configurable.

## 4.2 Order Operations

* Create order (admin/customer)
* Update order (including completed)
* Cancel order

## 4.3 Checkout Pricing Pipeline

Order of application:

1. Promotion
2. Voucher
3. Wallet
4. Loyalty points

## 4.4 Pricing Rules

* Customer group pricing applied automatically
* Admin can override price with reason

## 4.5 Shipment

* Multiple shipping methods
* Zones supported
* Partial delivery allowed

## 4.6 Payment

* COD
* Bank transfer (manual verification)

## 4.7 Notifications

* Order status notifications (e.g., Telegram)

## 4.8 Cancellation Rules

On cancellation:

* Release inventory
* Refund wallet
* Restore voucher usage

---

# 5. Customer (CRM) Domain

## 5.1 Customer Profile

Fields:

* shop name
* contact info (phone, email, social)
* notes

Supports multiple shipping addresses.

## 5.2 Customer Status

* ACTIVE
* INACTIVE
* BLOCKED

Rules:

* BLOCKED: cannot login or order

## 5.3 Customer Grouping

* Groups: VIP / Regular / New
* Determined by rules:

  * totalSpent
  * totalOrders

Supports manual override.

## 5.4 Tags & Events

* Customers can have tags
* Events tracked (behavioral data)

## 5.5 Metrics

* totalSpent
* totalOrders
* avgOrderValue
* LTV

---

# 6. Voucher & Promotion Domain

## 6.1 Voucher

* Can be:

  * code-based
  * auto-applied

## 6.2 Rules

* Stacking:

  * combinable vs non-combinable

* Constraints:

  * min order amount
  * usage limit (global + per customer)

## 6.3 Targeting

* By customer
* By customer group
* By product/category

## 6.4 Promotion

* Automatic discount without code
* Applied before voucher

---

# 7. Wallet Domain

## 7.1 Wallet

* Each customer has a wallet balance

## 7.2 Operations

* Credit (promotion/campaign)
* Debit (checkout)

## 7.3 Campaign

* Campaign distributes wallet credit
* Optional total budget limit

## 7.4 Refund

* On order cancel, wallet is refunded

---

# 8. Loyalty Domain

## 8.1 Points System

* Points earned per product
* Defined by earn rate

## 8.2 Calculation

points = floor(item_total / earn_rate)

## 8.3 Redemption

* Max % of order can be paid by points

## 8.4 Expiry

* Points may expire (optional)

---

# 9. Analytics Domain

## 9.1 Reports

* Sales analytics (daily/weekly/monthly)
* Revenue by category
* Inventory reports
* Order reports

## 9.2 Dashboard

* Aggregated metrics
* Period comparison

---

# 10. Admin & Access Control Domain

## 10.1 Roles & Permissions

* Custom roles
* Permissions defined by:

  * module
  * action (create/read/update/delete)

## 10.2 Access Control

* Permission-based authorization

---

# 11. Audit Domain

## 11.1 Audit Logging

* Track all CRUD operations

Includes:

* entity
* action
* old values
* new values
* user
* timestamp

---

# 12. Cross-Domain Business Rules

## 12.1 Checkout Flow

Promotion → Voucher → Wallet → Loyalty

## 12.2 Pricing Resolution

Customer group → PriceList → base price

## 12.3 Inventory Integration

* Order create → reserve inventory
* Order cancel → release inventory

## 12.4 Customer Restriction

* BLOCKED customer cannot place orders

## 12.5 Refund Flow

* Cancel order triggers:

  * wallet refund
  * voucher rollback

---

# 13. Summary

This domain model represents a complete B2B commerce + ERP system with tightly integrated pricing, inventory, and customer lifecycle management.

Key characteristics:

* Batch-aware inventory (FIFO)
* Multi-layer pricing system
* Event-driven capable flows (checkout, CRM updates)
* Modular domain separation (product, order, CRM, pricing)

This spec is intended as the foundation for designing the new architecture layer.
