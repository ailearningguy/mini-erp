import type { ModuleDefinition } from '@core/di/container';

function validateModuleDefinition(def: ModuleDefinition, moduleName: string): void {
  if (!def.exports || def.exports.length === 0) {
    throw new Error(`Module "${moduleName}" must export at least one service interface`);
  }

  for (const token of def.exports) {
    if (!def.providers.some(p => p.token === token)) {
      throw new Error(`Module "${moduleName}" exports "${token}" but no provider registered`);
    }
  }

  for (const token of def.exports) {
    if (!token.startsWith('I')) {
      throw new Error(`Exported token "${token}" in module "${moduleName}" must start with 'I'`);
    }
  }
}

export { validateModuleDefinition };