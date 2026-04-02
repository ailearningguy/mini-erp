import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = resolve(__dirname, '../src');

interface Violation {
  file: string;
  line: number;
  message: string;
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findFiles(fullPath, ext));
    } else if (fullPath.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function lintArchitecture(): Violation[] {
  const violations: Violation[] = [];
  const allFiles = findFiles(SRC_DIR, '.ts');

  for (const file of allFiles) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const relPath = file.replace(SRC_DIR + '/', '');

    if (relPath.startsWith('core/')) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("from '@modules/")) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'Core must not import from modules',
          });
        }
        if (lines[i].includes("from '@plugins/")) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'Core must not import from plugins',
          });
        }
      }
    }

    if (relPath.startsWith('plugins/')) {
      for (let i = 0; i < lines.length; i++) {
        if (/from '@modules\/.*\.(repository|schema)/.test(lines[i])) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: 'Plugins must use service interfaces, not repositories or schemas',
          });
        }
      }
    }

    if (relPath.startsWith('modules/')) {
      const moduleMatch = relPath.match(/^modules\/([^/]+)\//);
      if (moduleMatch) {
        const currentModule = moduleMatch[1];
        for (let i = 0; i < lines.length; i++) {
          const importMatch = lines[i].match(/from '@modules\/([^/]+)\//);
          if (importMatch && importMatch[1] !== currentModule) {
            violations.push({
              file: relPath,
              line: i + 1,
              message: `Module "${currentModule}" must not import from module "${importMatch[1]}"`,
            });
          }
        }
      }
    }
  }

  return violations;
}

const violations = lintArchitecture();
if (violations.length > 0) {
  console.error('Architecture violations found:');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — ${v.message}`);
  }
  process.exit(1);
} else {
  console.log('Architecture lint passed — no violations found.');
}