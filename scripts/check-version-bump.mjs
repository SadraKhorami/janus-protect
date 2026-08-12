import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.env.VERSION_BASE_REF || 'origin/main';
const productionPattern = /^(apps|packages|services|sdks)\/|^compose\.yaml$|^pnpm-lock\.yaml$/;
const repositoryRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let basePackage;
try {
  basePackage = JSON.parse(git(['show', `${base}:package.json`]));
} catch {
  process.stderr.write(
    `Unable to read package.json from ${base}. Set VERSION_BASE_REF if needed.\n`,
  );
  process.exit(1);
}

const currentPackage = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (!semanticVersion.test(currentPackage.version) || !semanticVersion.test(basePackage.version)) {
  process.stderr.write('Root versions must use MAJOR.MINOR.PATCH semantic versioning.\n');
  process.exit(1);
}

const workspacePackages = ['apps', 'packages'].flatMap((directory) => {
  const absolute = join(repositoryRoot, directory);
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(absolute, entry.name, 'package.json'))
    .filter(existsSync);
});
const mismatchedWorkspaces = workspacePackages
  .map((file) => ({ file, package: JSON.parse(readFileSync(file, 'utf8')) }))
  .filter((item) => item.package.version !== currentPackage.version);
if (mismatchedWorkspaces.length > 0) {
  process.stderr.write(
    `Workspace versions must match ${currentPackage.version}:\n${mismatchedWorkspaces
      .map((item) => `- ${item.package.name}: ${item.package.version}`)
      .join('\n')}\n`,
  );
  process.exit(1);
}
const committed = git(['diff', '--name-only', `${base}...HEAD`]);
const working = git(['diff', '--name-only', 'HEAD']);
const staged = git(['diff', '--cached', '--name-only']);
const untracked = git(['ls-files', '--others', '--exclude-standard']);
const changed = new Set(
  [committed, working, staged, untracked].flatMap((output) => output.split('\n').filter(Boolean)),
);
const productionChanged = [...changed].some((file) => productionPattern.test(file));

if (productionChanged && compareVersions(currentPackage.version, basePackage.version) <= 0) {
  process.stderr.write(
    `Production changes require a version newer than ${basePackage.version}; current is ${currentPackage.version}.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  productionChanged
    ? `Version guard passed: ${basePackage.version} -> ${currentPackage.version}.\n`
    : 'Version guard passed: no production changes detected.\n',
);

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}
