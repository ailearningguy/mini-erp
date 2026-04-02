import { Router } from 'express';
import type { ModuleInstaller } from './module-installer';
import type { Request, Response, NextFunction } from 'express';

function createModuleRoutes(moduleInstaller: ModuleInstaller): Router {
  const router = Router();

  router.get('/modules', (_req: Request, res: Response, next: NextFunction) => {
    try {
      const modules = moduleInstaller.list();
      res.json({ data: modules });
    } catch (err) {
      next(err);
    }
  });

  router.post('/modules/install', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Missing required field: name' },
        });
        return;
      }
      await moduleInstaller.install(name);
      res.json({ data: { status: 'installed', module: name } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/modules/uninstall', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Missing required field: name' },
        });
        return;
      }
      await moduleInstaller.uninstall(name);
      res.json({ data: { status: 'uninstalled', module: name } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export { createModuleRoutes };
