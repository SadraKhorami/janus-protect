import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync(process.execPath, ['dist/main.js'], {
  cwd: workerRoot,
  encoding: 'utf8',
  env: {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'production',
    ENV_FILE: resolve(workerRoot, 'scripts', 'missing-smoke-test.env'),
  },
  timeout: 10_000,
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

if (result.error) throw result.error;
if (output.includes('Dynamic require of "fs" is not supported')) {
  throw new Error('Worker bundle contains an ESM-incompatible dynamic require.');
}
if (result.status === 0 || !output.includes('Invalid environment configuration')) {
  throw new Error(`Worker bundle did not reach configuration validation:\n${output}`);
}
