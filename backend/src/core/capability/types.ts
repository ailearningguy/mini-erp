interface Capability {
  name: string;
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
}

interface CapabilityHandler {
  capability: string;
  stage?: string;
  priority?: number;
  exclusive?: boolean;
  condition?: (ctx: CapabilityContext) => boolean;
  plugin?: string;
  module?: string;
  handle: (ctx: CapabilityContext) => Promise<void>;
}

interface CapabilityContext {
  input: any;
  state: Record<string, any>;
  result?: any;
  stop?: boolean;
}

export type { Capability, CapabilityHandler, CapabilityContext };
