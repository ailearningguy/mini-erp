import type { Request, Response, NextFunction } from 'express';
import type { IInventoryService } from './interfaces/inventory.service.interface';
import { AdjustInventoryDtoSchema } from './dto/reserve-inventory.dto';
import { successResponse } from '@core/api/response';
import { AppError, ErrorCode } from '@shared/errors';

class InventoryController {
  constructor(private readonly inventoryService: IInventoryService) {}

  async getByProductId(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { productId } = req.params;
      const record = await this.inventoryService.getByProductId(productId);
      if (!record) {
        throw new AppError(ErrorCode.NOT_FOUND, `Inventory not found for product: ${productId}`, 404);
      }
      res.json(successResponse(record, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }

  async adjust(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = AdjustInventoryDtoSchema.parse(req.body);
      const record = await this.inventoryService.adjust(dto.productId, dto.quantity);
      res.json(successResponse(record, (req as any).id!));
    } catch (error) {
      next(error);
    }
  }
}

export { InventoryController };