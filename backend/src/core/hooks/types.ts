interface HookPoint {
  name: string;
  phase: 'pre' | 'post';
  timeout?: number;
  failSafe?: boolean;
}

interface HookHandler<TData = unknown> {
  plugin?: string;
  module?: string;
  priority?: number;
  handler: (context: HookContext<TData>) => Promise<void>;
}

interface HookContext<TData = unknown> {
  data: TData;
  result?: unknown;
  stopPropagation?: boolean;
  metadata: {
    point: string;
    phase: 'pre' | 'post';
    executionId: string;
  };
}

interface HookRegistration<TData = unknown> {
  point: string;
  phase: 'pre' | 'post';
  handler: (ctx: HookContext<TData>) => Promise<void>;
  plugin?: string;
  module?: string;
  priority?: number;
  timeout?: number;
  failSafe?: boolean;
}

export type { HookPoint, HookHandler, HookContext, HookRegistration };
