import type { Request, Response, NextFunction } from 'express';
import type { IOrderService } from './interfaces/order.service.interface';
import { CreateOrderDtoSchema } from './dto/create-order.dto';
import { successResponse } from '@core/api/response';
import { AppError, ErrorCode } from '@shared/errors';
import { API_CONSTANTS } from '@shared/constants';

class OrderController {
  constructor(private readonly orderService: IOrderService) {}

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const order = await this.orderService.getById(id);
      if (!order) {
        throw new AppError(ErrorCode.NOT_FOUND, `Order not found: ${id}`, 404);
      }
      res.json(successResponse(order, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Math.min(
        Number(req.query.limit) || API_CONSTANTS.DEFAULT_PAGE_SIZE,
        API_CONSTANTS.MAX_PAGE_SIZE,
      );
      const cursor = req.query.cursor as string | undefined;
      const result = await this.orderService.list(limit, cursor);
      res.json(successResponse(result.items, (req as any).id!, {
        cursor: result.nextCursor,
        has_more: result.nextCursor !== null,
        limit,
      }));
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = CreateOrderDtoSchema.parse(req.body);
      const order = await this.orderService.create(dto.customerId, dto.items);
      res.status(201).json(successResponse(order, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }
}

export { OrderController };