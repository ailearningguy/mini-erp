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
