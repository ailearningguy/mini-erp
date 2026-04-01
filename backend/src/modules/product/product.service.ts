import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { products } from './product.schema';
import type { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import type { IProductService, Product } from './interfaces/product.service.interface';
import { EventBus } from '@core/event-bus/event-bus';
import { AppError, ErrorCode } from '@shared/errors';

type AnyDb = Record<string, unknown>;

class ProductService implements IProductService {
  constructor(
    private readonly db: AnyDb,
    private readonly eventBus: EventBus,
  ) {}

  async getById(id: string): Promise<Product | null> {
    const result = await (this.db as any)
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    return result[0] ?? null;
  }

  async getBySku(sku: string): Promise<Product | null> {
    const result = await (this.db as any)
      .select()
      .from(products)
      .where(eq(products.sku, sku))
      .limit(1);
    return result[0] ?? null;
  }

  async list(limit: number, cursor?: string): Promise<{ items: Product[]; nextCursor: string | null }> {
    const query = (this.db as any)
      .select()
      .from(products)
      .where(eq(products.isActive, true))
      .limit(limit + 1);

    const result = await query;
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const existing = await this.getBySku(dto.sku);
    if (existing) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Product with SKU "${dto.sku}" already exists`,
        409,
        { sku: dto.sku },
      );
    }

    const id = randomUUID();

    const result = await (this.db as any).transaction(async (tx: AnyDb) => {
      await tx.insert(products).values({
        id,
        productName: dto.productName,
        sku: dto.sku,
        basePrice: dto.basePrice.toString(),
        stock: dto.stock,
      });

      await this.eventBus.emit(
        {
          type: 'product.created.v1',
          source: 'product-service',
          aggregate_id: id,
          payload: {
            productId: id,
            productName: dto.productName,
            sku: dto.sku,
            basePrice: dto.basePrice,
            stock: dto.stock,
          },
          metadata: { version: 'v1' },
        },
        tx,
      );

      const created = await tx
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      return created[0];
    });

    return result;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, `Product not found: ${id}`, 404);
    }

    if (existing.version !== dto.version) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Version conflict — product has been modified by another request',
        409,
        { expectedVersion: dto.version, actualVersion: existing.version },
      );
    }

    const changes: Record<string, unknown> = {};
    if (dto.productName !== undefined) changes.productName = dto.productName;
    if (dto.basePrice !== undefined) changes.basePrice = dto.basePrice.toString();
    if (dto.stock !== undefined) changes.stock = dto.stock;
    if (dto.isActive !== undefined) changes.isActive = dto.isActive;

    const result = await (this.db as any).transaction(async (tx: AnyDb) => {
      await tx
        .update(products)
        .set({
          ...changes,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id));

      await this.eventBus.emit(
        {
          type: 'product.updated.v1',
          source: 'product-service',
          aggregate_id: id,
          payload: {
            productId: id,
            changes,
            previousVersion: existing.version,
          },
          metadata: { version: 'v1' },
        },
        tx,
      );

      const updated = await tx
        .select()
        .from(products)
        .where(eq(products.id, id))
        .limit(1);

      return updated[0];
    });

    return result;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, `Product not found: ${id}`, 404);
    }

    await (this.db as any).transaction(async (tx: AnyDb) => {
      await tx
        .update(products)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(products.id, id));

      await this.eventBus.emit(
        {
          type: 'product.deleted.v1',
          source: 'product-service',
          aggregate_id: id,
          payload: {
            productId: id,
            productName: existing.productName,
            sku: existing.sku,
          },
          metadata: { version: 'v1' },
        },
        tx,
      );
    });
  }
}

export { ProductService };
