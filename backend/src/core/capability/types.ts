interface Capability {
  name: string;
  type: 'pipeline' | 'single' | 'composable';
  stages?: string[];
}

interface CapabilityHandler<TInput = unknown, TResult = unknown> {
  capability: string;
  stage?: string;
  priority?: number;
  exclusive?: boolean;
  condition?: (ctx: CapabilityContext<TInput, TResult>) => boolean;
  plugin?: string;
  module?: string;
  handle: (ctx: CapabilityContext<TInput, TResult>) => Promise<void>;
}

interface CapabilityContext<TInput = unknown, TResult = unknown> {
  input: TInput;
  state: Record<string, unknown>;
  result?: TResult;
  stop?: boolean;
}

export type { Capability, CapabilityHandler, CapabilityContext };
