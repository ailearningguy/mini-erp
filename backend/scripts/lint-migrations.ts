import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

interface MigrationRule {
  name: string;
  check: (sql: string) => LintViolation[];
}

interface LintViolation {
  rule: string;
  error: string;
  line?: number;
  sql?: string;
}

interface LintResult {
  valid: boolean;
  violations: LintViolation[];
}

const migrationRules: MigrationRule[] = [
  {
    name: 'no-not-null-without-default',
    check(sql: string): LintViolation[] {
      const violations: LintViolation[] = [];
      const lines = sql.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
          line.toUpperCase().includes('ADD COLUMN') &&
          line.toUpperCase().includes('NOT NULL') &&
          !line.toUpperCase().includes('DEFAULT')
        ) {
          violations.push({
            rule: 'no-not-null-without-default',
            error: 'Cannot add NOT NULL column without DEFAULT in single migration. '
              + 'Use 2-step: ADD nullable → backfill → SET NOT NULL',
            line: i + 1,
            sql: line,
          });
        }
      }
      return violations;
    },
  },
  {
    name: 'statement-timeout-set',
    check(sql: string): LintViolation[] {
      const hasTimeout = sql.toUpperCase().includes('SET STATEMENT_TIMEOUT');
      if (!hasTimeout) {
        return [{
          rule: 'statement-timeout-set',
          error: 'Migration MUST set statement_timeout to avoid blocking reads',
        }];
      }
      return [];
    },
  },
  {
    name: 'reversible-sql-only',
    check(sql: string): LintViolation[] {
      const violations: LintViolation[] = [];
      const destructivePatterns = ['DROP COLUMN', 'DROP TABLE', 'DROP INDEX', 'TRUNCATE'];
      const lines = sql.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim().toUpperCase();
        for (const pattern of destructivePatterns) {
          if (line.includes(pattern)) {
            violations.push({
              rule: 'reversible-sql-only',
              error: `Destructive statement detected: "${pattern}". Requires manual review.`,
              line: i + 1,
              sql: lines[i].trim(),
            });
          }
        }
      }
      return violations;
    },
  },
];

class MigrationLinter {
  constructor(private readonly migrationsDir: string) {}

  lintAll(): LintResult {
    const files = readdirSync(this.migrationsDir).filter((f) => f.endsWith('.sql'));
    const allViolations: LintViolation[] = [];

    for (const file of files) {
      const sql = readFileSync(join(this.migrationsDir, file), 'utf-8');
      const violations = this.lint(sql);
      allViolations.push(...violations);
    }

    return {
      valid: allViolations.length === 0,
      violations: allViolations,
    };
  }

  lint(sql: string): LintViolation[] {
    return migrationRules.flatMap((rule) => rule.check(sql));
  }
}

// CLI entry point
if (process.argv[1]?.includes('lint-migrations')) {
  const migrationsDir = process.argv[2] || './database/migrations';
  const linter = new MigrationLinter(migrationsDir);
  const result = linter.lintAll();

  if (result.valid) {
    console.log('✅ All migrations pass lint rules');
    process.exit(0);
  } else {
    console.error('❌ Migration lint violations found:');
    for (const v of result.violations) {
      console.error(`  [${v.rule}] ${v.error}`);
      if (v.line) console.error(`    Line ${v.line}: ${v.sql}`);
    }
    process.exit(1);
  }
}

export { MigrationLinter };
export type { LintResult, LintViolation };
