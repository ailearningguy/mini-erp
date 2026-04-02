interface InventoryRecord {
  id: string;
  productId: string;
  quantity: number;
  reserved: number;
  version: number;
  updatedAt: Date;
}

interface ReserveItem {
  productId: string;
  quantity: number;
}

interface IInventoryService {
  getByProductId(productId: string): Promise<InventoryRecord | null>;
  reserve(orderId: string, items: ReserveItem[]): Promise<void>;
  release(orderId: string): Promise<void>;
  adjust(productId: string, quantity: number): Promise<InventoryRecord>;
}

export type { IInventoryService, InventoryRecord, ReserveItem };