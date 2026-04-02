import type { HookRegistration } from './types';

function detectHookConflicts(hooks: HookRegistration[]): void {
  const byPointPhase = new Map<string, HookRegistration[]>();

  for (const hook of hooks) {
    const key = `${hook.point}:${hook.phase}`;
    const list = byPointPhase.get(key) ?? [];
    list.push(hook);
    byPointPhase.set(key, list);
  }

  for (const [key, registrations] of byPointPhase) {
    const sources = registrations.map(r => {
      if (r.plugin) return `plugin:${r.plugin}`;
      if (r.module) return `module:${r.module}`;
      return 'unknown';
    });

    const seen = new Set<string>();
    for (const source of sources) {
      if (source === 'unknown') continue;
      if (seen.has(source)) {
        throw new Error(`Duplicate hook registration: ${source} on ${key}`);
      }
      seen.add(source);
    }
  }
}

export { detectHookConflicts };