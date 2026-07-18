import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const versionArgs = process.argv.slice(2);
const versionBump = versionArgs.length === 0 ? ['patch'] : versionArgs;

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const getOutput = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
};

const artifactFile = /\.(dmg|zip|exe|appimage|deb|rpm)$/i;

const collectFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = join(directory, entry.name);
  return entry.isDirectory() ? collectFiles(file) : artifactFile.test(file) ? [file] : [];
});

if (getOutput('git', ['status', '--porcelain'])) {
  throw new Error('Git working directory must be clean before releasing.');
}

run('npm', ['version', ...versionBump, '--no-git-tag-version']);
run('bun', ['run', 'website:build']);
run('bun', ['run', 'dist']);

const version = getOutput('node', ['-p', "require('./package.json').version"]);
const artifacts = collectFiles('release');

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
