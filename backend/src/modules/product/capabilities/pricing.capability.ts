import type { Capability, CapabilityHandler } from '@core/capability/types';

const pricingCapability: Capability = {
  name: 'pricing',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
};

const basePriceHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'base',
  priority: 10,
  module: 'product',
  handle: async (ctx) => {
    ctx.state.basePrice = ctx.input.basePrice;
    ctx.result = ctx.input.basePrice;
  },
};

const roundingHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'rounding',
  priority: 50,
  module: 'product',
  handle: async (ctx) => {
    ctx.result = Math.round((ctx.result ?? 0) * 100) / 100;
  },
};

const finalPriceHandler: CapabilityHandler = {
  capability: 'pricing',
  stage: 'final',
  priority: 50,
  module: 'product',
  handle: async (ctx) => {
    ctx.state.finalPrice = ctx.result;
  },
};

export {
  pricingCapability,
  basePriceHandler,
  roundingHandler,
  finalPriceHandler,
};
