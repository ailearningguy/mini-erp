import type { Capability } from '@core/capability/types';
import type { CapabilityContract, VersionedCapabilityHandler } from '@core/capability-governance/types';

const pricingContract: CapabilityContract = {
  name: 'pricing',
  version: '1.0.0',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
  compatibility: {
    backwardCompatible: true,
  },
};

const pricingCapability: Capability = {
  name: 'pricing',
  type: 'pipeline',
  stages: ['base', 'discount', 'tax', 'rounding', 'final'],
};

const basePriceHandler: VersionedCapabilityHandler = {
  capability: 'pricing',
  stage: 'base',
  priority: 10,
  module: 'product',
  supportedVersion: '^1.0.0',
  handle: async (ctx) => {
    ctx.state.basePrice = ctx.input.basePrice;
    ctx.result = ctx.input.basePrice;
  },
};

const roundingHandler: VersionedCapabilityHandler = {
  capability: 'pricing',
  stage: 'rounding',
  priority: 50,
  module: 'product',
  supportedVersion: '^1.0.0',
  handle: async (ctx) => {
    ctx.result = Math.round((ctx.result ?? 0) * 100) / 100;
  },
};

const finalPriceHandler: VersionedCapabilityHandler = {
  capability: 'pricing',
  stage: 'final',
  priority: 50,
  module: 'product',
  supportedVersion: '^1.0.0',
  handle: async (ctx) => {
    ctx.state.finalPrice = ctx.result;
  },
};

export {
  pricingContract,
  pricingCapability,
  basePriceHandler,
  roundingHandler,
  finalPriceHandler,
};