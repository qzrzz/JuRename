import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const versionArgs = process.argv.slice(2);
const versionBump = versionArgs.length === 0 ? ['patch'] : versionArgs;

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} was terminated by ${result.signal}.`);
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status ?? 1}.`);
};

const getOutput = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
};

const artifactFile = /\.(dmg|zip|exe|appimage|deb|rpm)$/i;

const collectFiles = (directory, version) => readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.includes(version) && artifactFile.test(entry.name))
  .map((entry) => join(directory, entry.name));

if (getOutput('git', ['status', '--porcelain'])) {
  throw new Error('Git working directory must be clean before releasing.');
}

run(process.execPath, ['scripts/build-all-platforms.mjs', '--check']);
const originalPackageJson = readFileSync('package.json', 'utf8');
try {
  run('npm', ['version', ...versionBump, '--no-git-tag-version']);
  run('bun', ['run', 'website:build']);
  run('bun', ['run', 'dist']);
} catch (error) {
  writeFileSync('package.json', originalPackageJson);
  throw error;
}

const version = getOutput('node', ['-p', "require('./package.json').version"]);
const artifacts = collectFiles('release', version);

if (artifacts.length === 0) {
  throw new Error('No release artifacts were generated.');
}

run('git', ['add', 'package.json', 'docs']);
run('git', ['commit', '-m', `chore(release): v${version}`]);
run('git', ['tag', `v${version}`]);
const branch = getOutput('git', ['branch', '--show-current']);
run('git', ['push', 'origin', branch, `refs/tags/v${version}`]);

run('gh', [
  'release', 'create', `v${version}`, ...artifacts,
  '--title', `JuRename v${version}`,
  '--generate-notes',
]);
