interface HookPoint {
  name: string;
  phase: 'pre' | 'post';
  timeout?: number;
  failSafe?: boolean;
}

interface HookHandler {
  plugin?: string;
  module?: string;
  priority?: number;
  handler: (context: HookContext) => Promise<void>;
}

interface HookContext {
  data: any;
  result?: any;
  stopPropagation?: boolean;
  metadata: {
    point: string;
    phase: 'pre' | 'post';
    executionId: string;
  };
}

interface HookRegistration {
  point: string;
  phase: 'pre' | 'post';
  handler: (ctx: HookContext) => Promise<void>;
  plugin?: string;
  module?: string;
  priority?: number;
  timeout?: number;
  failSafe?: boolean;
}

export type { HookPoint, HookHandler, HookContext, HookRegistration };