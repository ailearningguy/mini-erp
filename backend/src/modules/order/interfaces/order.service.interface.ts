interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  status: string;
  totalAmount: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface IOrderService {
  getById(id: string): Promise<Order | null>;
  list(limit: number, cursor?: string): Promise<{ items: Order[]; nextCursor: string | null }>;
  create(customerId: string, items: { productId: string; quantity: number }[]): Promise<Order>;
  confirm(orderId: string): Promise<Order>;
  cancel(orderId: string): Promise<Order>;
}

export type { IOrderService, Order };