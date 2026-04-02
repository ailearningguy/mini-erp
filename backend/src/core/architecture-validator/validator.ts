interface DependencyGraph {
  nodes: string[];
  edges: { from: string; to: string }[];
}

interface PluginRegistration {
  name: string;
  permissions: { resource: string; actions: string[]; scope?: string }[];
  activatedAt: Date | null;
}

interface ServiceBinding {
  token: string;
  implementation: string;
  isInterface: boolean;
}

class ArchitectureValidator {
  async validateOnStartup(
    diTokens: string[],
    dependencyResolver: (token: string) => string[],
  ): Promise<void> {
    this.validateDIGraph(diTokens, dependencyResolver);
    this.validateServiceBindings(diTokens);
  }

  private validateDIGraph(
    tokens: string[],
    getDeps: (token: string) => string[],
  ): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const cycles: string[][] = [];

    const visit = (token: string, path: string[]): void => {
      if (visiting.has(token)) {
        const cycleStart = path.indexOf(token);
        if (cycleStart !== -1) {
          cycles.push([...path.slice(cycleStart), token]);
        }
        return;
      }
      if (visited.has(token)) return;

      visiting.add(token);
      path.push(token);

      const deps = getDeps(token);
      for (const dep of deps) {
        visit(dep, [...path]);
      }

      path.pop();
      visiting.delete(token);
      visited.add(token);
    };

    for (const token of tokens) {
      visit(token, []);
    }

    if (cycles.length > 0) {
      const descriptions = cycles.map((c) => c.join(' -> ')).join('\n  ');
      throw new Error(`Circular dependencies detected:\n  ${descriptions}`);
    }
  }

  private validateServiceBindings(tokens: string[]): void {
    const requiredCore = [
      'EventBus',
      'EventSchemaRegistry',
      'OutboxRepository',
      'Config',
      'Database',
    ];

    for (const required of requiredCore) {
      if (!tokens.includes(required)) {
        throw new Error(
          `Missing required core service: ${required}. `
          + 'All core services MUST be registered in the DI container.',
        );
      }
    }
  }

  validateNoCoreToModule(graph: DependencyGraph): void {
    const coreModules = graph.nodes.filter(n => n.startsWith('core/'));
    const moduleModules = graph.nodes.filter(n => n.startsWith('modules/'));
    const coreToModuleEdges = graph.edges.filter(
      e => coreModules.includes(e.from) && moduleModules.includes(e.to)
    );

    if (coreToModuleEdges.length > 0) {
      throw new Error(
        `Core must not depend on modules. Found ${coreToModuleEdges.length} violations.`
      );
    }
  }

  validateNoCoreToPlugin(graph: DependencyGraph): void {
    const coreModules = graph.nodes.filter(n => n.startsWith('core/'));
    const pluginModules = graph.nodes.filter(n => n.startsWith('plugins/'));
    const coreToPluginEdges = graph.edges.filter(
      e => coreModules.includes(e.from) && pluginModules.includes(e.to)
    );

    if (coreToPluginEdges.length > 0) {
      throw new Error(
        `Core must not depend on plugins. Found ${coreToPluginEdges.length} violations.`
      );
    }
  }

  validatePluginGuards(plugins: PluginRegistration[]): void {
    for (const plugin of plugins) {
      if (!plugin.permissions) continue;

      for (const perm of plugin.permissions) {
        if (!perm.resource || !perm.actions || perm.actions.length === 0) {
          throw new Error(
            `Invalid permission in plugin "${plugin.name}": resource and actions are required`
          );
        }
      }
    }
  }

  validateServiceInterfaces(bindings: ServiceBinding[]): void {
    for (const binding of bindings) {
      if (binding.isInterface && !binding.token.startsWith('I')) {
        throw new Error(
          `Interface token "${binding.token}" must start with 'I' prefix`
        );
      }
    }
  }

  validatePluginImports(
    pluginSource: string,
    importPath: string,
  ): void {
    const forbiddenPatterns = [
      /^@modules\/.*\/.*\.repository/,
      /^@modules\/.*\/.*\.schema/,
      /\.repository\./,
      /\.schema\./,
    ];

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(importPath)) {
        throw new Error(
          `Architecture violation: Plugin "${pluginSource}" cannot import "${importPath}". `
          + 'Plugins must use service interfaces, not repositories or schemas.',
        );
      }
    }
  }

  validateCrossModuleImport(
    sourceModule: string,
    importPath: string,
  ): void {
    const modulePattern = /^@modules\/([^/]+)\//;
    const match = importPath.match(modulePattern);

    if (match && match[1] !== sourceModule) {
      throw new Error(
        `Architecture violation: Module "${sourceModule}" cannot import from module "${match[1]}". `
        + 'Modules must communicate via service interfaces and events.',
      );
    }
  }
}

export { ArchitectureValidator };
export type { DependencyGraph, PluginRegistration, ServiceBinding };
