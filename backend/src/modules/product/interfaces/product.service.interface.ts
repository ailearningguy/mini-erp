import type { CreateProductDto } from '../dto/create-product.dto';
import type { UpdateProductDto } from '../dto/create-product.dto';

interface Product {
  id: string;
  productName: string;
  sku: string;
  basePrice: string;
  stock: number;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface IProductService {
  getById(id: string): Promise<Product | null>;
  getBySku(sku: string): Promise<Product | null>;
  list(limit: number, cursor?: string): Promise<{ items: Product[]; nextCursor: string | null }>;
  create(dto: CreateProductDto): Promise<Product>;
  update(id: string, dto: UpdateProductDto): Promise<Product>;
  delete(id: string): Promise<void>;
}

export type { IProductService, Product };
