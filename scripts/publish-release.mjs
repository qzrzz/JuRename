import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  return result.status === 0;
};

const artifactFile = /\.(dmg|zip|exe|appimage|deb|rpm)$/i;
const collectArtifacts = (directory) => readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && artifactFile.test(entry.name))
  .map((entry) => `${directory}/${entry.name}`);

const version = JSON.parse(spawnSync('node', ['-p', "JSON.stringify(require('./package.json').version)"], {
  encoding: 'utf8',
}).stdout);
const tag = `v${version}`;

if (!existsSync('release')) {
  throw new Error('No release directory found. Build artifacts before publishing.');
}

const artifacts = collectArtifacts('release');
if (artifacts.length === 0) {
  throw new Error('No distributable artifacts found in release/.');
}

if (run('gh', ['release', 'view', tag], { stdio: 'ignore' })) {
  if (!run('gh', ['release', 'upload', tag, ...artifacts, '--clobber'])) process.exit(1);
} else if (!run('gh', [
  'release', 'create', tag, ...artifacts,
  '--title', `JuRename ${tag}`,
  '--generate-notes',
])) {
  process.exit(1);
}
