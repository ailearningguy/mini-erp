import type { Request, Response, NextFunction } from 'express';
import type { IProductService } from './interfaces/product.service.interface';
import { CreateProductDtoSchema, UpdateProductDtoSchema } from './dto/create-product.dto';
import { successResponse } from '@core/api/response';
import { AppError, ErrorCode } from '@shared/errors';
import { API_CONSTANTS } from '@shared/constants';

class ProductController {
  constructor(private readonly productService: IProductService) {}

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const product = await this.productService.getById(id);
      if (!product) {
        throw new AppError(ErrorCode.NOT_FOUND, `Product not found: ${id}`, 404);
      }
      res.json(successResponse(product, req.id!));
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

      const result = await this.productService.list(limit, cursor);
      res.json(
        successResponse(result.items, req.id!, {
          cursor: result.nextCursor,
          has_more: result.nextCursor !== null,
          limit,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = CreateProductDtoSchema.parse(req.body);
      const product = await this.productService.create(dto);
      res.status(201).json(successResponse(product, req.id!));
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const dto = UpdateProductDtoSchema.parse(req.body);
      const product = await this.productService.update(id, dto);
      res.json(successResponse(product, req.id!));
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      await this.productService.delete(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export { ProductController };
