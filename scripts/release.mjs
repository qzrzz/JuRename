import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const versionArgs = process.argv.slice(2);
const versionBump = versionArgs.length === 0 ? ['patch'] : versionArgs;

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const collectFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = join(directory, entry.name);
  return entry.isDirectory() ? collectFiles(file) : [file];
});

run('npm', ['version', ...versionBump]);
run('bun', ['run', 'dist:all']);
run('git', ['push', '--follow-tags']);

const version = JSON.parse(spawnSync('node', ['-p', "JSON.stringify(require('./package.json').version)"], {
  encoding: 'utf8',
}).stdout);
const artifacts = collectFiles('release');

if (artifacts.length === 0) {
  throw new Error('No release artifacts were generated.');
}

run('gh', [
  'release', 'create', `v${version}`, ...artifacts,
  '--title', `JuRename v${version}`,
  '--generate-notes',
]);
