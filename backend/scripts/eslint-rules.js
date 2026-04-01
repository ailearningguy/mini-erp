// Custom ESLint rules for architecture enforcement
// These rules enforce ADR-006: Compile-time architecture validation

const DOMAIN_KEYWORDS = [
  'product', 'order', 'inventory', 'voucher', 'customer',
  'wallet', 'loyalty', 'payment', 'shipping', 'supplier',
  'category', 'brand', 'attribute', 'variant', 'bundle',
];

const RULES = {
  'no-cross-module-import': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid cross-module imports' },
      schema: [],
    },
    create(context) {
      const filename = context.getFilename();
      const moduleMatch = filename.match(/src\/modules\/([^/]+)\//);
      if (!moduleMatch) return {};

      const currentModule = moduleMatch[1];

      return {
        ImportDeclaration(node) {
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
    create(context) {
      const filename = context.getFilename();
      if (!filename.includes('/plugins/')) return {};

      return {
        ImportDeclaration(node) {
          const importPath = node.source.value;
          if (importPath.includes('.repository')) {
            context.report({
              node,
              message: 'Plugins cannot import repositories. Use service interfaces instead.',
            });
          }
          if (importPath.includes('/modules/') && importPath.includes('.schema')) {
            context.report({
              node,
              message: 'Plugins cannot import module schemas. Use service interfaces or plugin-scoped isolated storage.',
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
    create(context) {
      const filename = context.getFilename();
      if (!filename.includes('/plugins/')) return {};

      return {
        CallExpression(node) {
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'emit' &&
            node.arguments.length > 0
          ) {
            const eventTypeArg = node.arguments[0];
            if (eventTypeArg.type === 'ObjectExpression') {
              const typeProp = eventTypeArg.properties.find(
                (p) => p.key.name === 'type',
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
    create(context) {
      const filename = context.getFilename();
      if (filename.includes('/core/outbox')) return {};

      return {
        ImportDeclaration(node) {
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
    create(context) {
      return {
        ImportDeclaration(node) {
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

  'no-plugin-import-from-module': {
    meta: {
      type: 'problem',
      docs: { description: 'Prevent modules from importing plugin internals' },
      schema: [],
    },
    create(context) {
      const filename = context.getFilename();
      const isModuleFile = filename.includes('/src/modules/');
      const isPluginFile = filename.includes('/src/plugins/');

      if (!isModuleFile || isPluginFile) {
        return {};
      }

      return {
        ImportDeclaration(node) {
          const source = node.source.value;
          if (typeof source === 'string' && (source.startsWith('@plugins/') || source.includes('/plugins/'))) {
            context.report({
              node,
              message: 'Modules cannot import from plugins. Use service interfaces and events instead.',
            });
          }
        },
      };
    },
  },

  'no-domain-keyword': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid domain keywords in core' },
      schema: [],
    },
    create(context) {
      const filename = context.getFilename();
      if (!filename.includes('/src/core/')) return {};

      const hasDomainSuffix = (name) => {
        const suffixes = ['Id', 'Name', 'Status', 'Service', 'Repository', 'Controller', 'Module', 'Event', 'Schema', 'By'];
        return suffixes.some(s => name.toLowerCase().endsWith(s.toLowerCase()));
      };

      return {
        'Identifier[name]'(node) {
          const name = node.name.toLowerCase();
          for (const kw of DOMAIN_KEYWORDS) {
            if (name === kw || (name.startsWith(kw) && name.length > kw.length && /[A-Z]/.test(name[kw.length]))) {
              if (hasDomainSuffix(node.name)) continue;
              context.report({
                node,
                message: `Domain keyword "${kw}" is not allowed in core`,
              });
              break;
            }
          }
        },
      };
    },
  },

  'no-domain-enum': {
    meta: {
      type: 'problem',
      docs: { description: 'Forbid domain enums in core' },
      schema: [],
    },
    create(context) {
      const filename = context.getFilename();
      if (!filename.includes('/src/core/')) return {};

      return {
        TSEnumDeclaration(node) {
          const members = node.members || [];
          for (const member of members) {
            const name = member.id?.name?.toLowerCase() || '';
            for (const kw of DOMAIN_KEYWORDS) {
              if (name.includes(kw)) {
                context.report({
                  node,
                  message: `Domain enum containing "${kw}" is not allowed in core`,
                });
                break;
              }
            }
          }
        },
      };
    },
  },
};

export default RULES;
