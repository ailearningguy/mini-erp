import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

function findTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findTsFiles(fullPath));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Core Type Safety', () => {
  it('should not use "as any" cast in core files', () => {
    const coreDir = resolve(__dirname, '../../src/core');
    const files = findTsFiles(coreDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (/\bas\s+any\b/.test(line) && !line.trim().startsWith('//')) {
          const fileName = file.split('/').pop() || '';
          if (fileName.includes('amqp-consumer') || fileName.includes('outbox-worker.entry')) {
            return;
          }
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});