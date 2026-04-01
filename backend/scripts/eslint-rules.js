// Custom ESLint rules for architecture enforcement
// These rules enforce ADR-006: Compile-time architecture validation

const RULES = {
  'no-cross-module-import': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid cross-module imports' },
      schema: [],
    },
    create(context: any) {
      const filename = context.getFilename();
      const moduleMatch = filename.match(/src\/modules\/([^/]+)\//);
      if (!moduleMatch) return {};

      const currentModule = moduleMatch[1];

      return {
        ImportDeclaration(node: any) {
          const importPath = node.source.value;
          const importedModuleMatch = importPath.match(/@modules\/([^/]+)\//);

          if (importedModuleMatch && importedModuleMatch[1] !== currentModule) {
            context.report({
              node,
              message: `Module "${currentModule}" cannot import from module "${importedModuleMatch[1]}". Use service interfaces and events instead.`,
            });
          }
        },
      };
    },
  },

  'no-repository-in-plugin': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid repository injection in plugins' },
      schema: [],
    },
    create(context: any) {
      const filename = context.getFilename();
      if (!filename.includes('/plugins/')) return {};

      return {
        ImportDeclaration(node: any) {
          const importPath = node.source.value;
          if (importPath.includes('.repository') || importPath.includes('.schema')) {
            context.report({
              node,
              message: 'Plugins cannot import repositories or schemas. Use service interfaces instead.',
            });
          }
        },
      };
    },
  },

  'no-core-event-from-plugin': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid core domain event emission from plugins' },
      schema: [],
    },
    create(context: any) {
      const filename = context.getFilename();
      if (!filename.includes('/plugins/')) return {};

      return {
        CallExpression(node: any) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'emit' &&
            node.arguments.length > 0
          ) {
            const eventTypeArg = node.arguments[0];
            if (eventTypeArg.type === 'ObjectExpression') {
              const typeProp = eventTypeArg.properties.find(
                (p: any) => p.key.name === 'type',
              );
              if (typeProp && typeProp.value.type === 'Literal') {
                const eventType = typeProp.value.value;
                if (!eventType.startsWith('plugin.')) {
                  context.report({
                    node,
                    message: `Plugins cannot emit core domain events (${eventType}). Use plugin-scoped events (e.g., analytics.tracked.v1) instead.`,
                  });
                }
              }
            }
          }
        },
      };
    },
  },

  'no-outbox-direct-access': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid direct outbox access outside core' },
      schema: [],
    },
    create(context: any) {
      const filename = context.getFilename();
      if (filename.includes('/core/outbox')) return {};

      return {
        ImportDeclaration(node: any) {
          const importPath = node.source.value;
          if (importPath.includes('/core/outbox')) {
            context.report({
              node,
              message: 'Direct outbox access is forbidden outside core. Use EventBus.emit() instead.',
            });
          }
        },
      };
    },
  },

  'no-infra-config-import': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid importing infrastructure configs' },
      schema: [],
    },
    create(context: any) {
      return {
        ImportDeclaration(node: any) {
          const importPath = node.source.value;
          const infraPatterns = ['docker-compose', 'k8s', 'kubernetes', 'terraform', '.env'];
          if (infraPatterns.some((p) => importPath.includes(p))) {
            context.report({
              node,
              message: 'Cannot import infrastructure configuration files.',
            });
          }
        },
      };
    },
  },
};

export default RULES;
