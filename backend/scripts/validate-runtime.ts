import { execSync } from 'node:child_process';

console.log('Running runtime validation checks...');

console.log('  [1/3] Typecheck...');
try {
  execSync('npx tsc --noEmit', { stdio: 'pipe' });
  console.log('  [1/3] Typecheck PASS');
} catch {
  console.error('  [1/3] Typecheck FAIL');
  process.exit(1);
}

console.log('  [2/3] Tests...');
try {
  execSync('npx jest --passWithNoTests', { stdio: 'pipe' });
  console.log('  [2/3] Tests PASS');
} catch {
  console.error('  [2/3] Tests FAIL');
  process.exit(1);
}

console.log('  [3/3] Architecture lint...');
try {
  execSync('npx tsx scripts/lint-arch.ts', { stdio: 'pipe' });
  console.log('  [3/3] Architecture lint PASS');
} catch {
  console.error('  [3/3] Architecture lint FAIL');
  process.exit(1);
}

console.log('All runtime validation checks passed.');