import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const denoRoot = join(root, 'deno-desktop');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
if (typeof version !== 'string' || !version) {
  throw new Error('package.json must contain a version.');
}
const tag = `v${version}`;

const repositoryUrl = new URL(packageJson.homepage);
if (repositoryUrl.hostname !== 'github.com') {
  throw new Error(`package.json homepage must point to github.com, received ${packageJson.homepage}.`);
}
const repository = repositoryUrl.pathname
  .replace(/^\//, '')
  .replace(/\/$/, '')
  .replace(/\.git$/, '');
if (repository.split('/').length !== 2) {
  throw new Error(`Cannot determine GitHub repository from ${packageJson.homepage}.`);
}

const assets = [
  {
    path: join(
      denoRoot,
      'artifacts',
      'github-release',
      `[deno-desktop]-JuRename-${version}-macOS-arm64.zip`,
    ),
    label: `[deno-desktop] JuRename ${version} macOS ARM64`,
  },
  {
    path: join(
      denoRoot,
      'artifacts',
      'github-release',
      `[deno-desktop]-JuRename-${version}-Windows-x64.msi`,
    ),
    label: `[deno-desktop] JuRename ${version} Windows x64`,
  },
];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} was terminated by ${result.signal}.`);
  if (result.status !== 0 && !options.allowFailure) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} exited with code ${result.status ?? 1}.`);
  }
  return result;
};

const escapeGhGlob = (path) => path.replaceAll('[', '\\[').replaceAll(']', '\\]');
const ghAssets = assets.map(({ path, label }) => `${escapeGhGlob(path)}#${label}`);

run('gh', ['auth', 'status', '--hostname', 'github.com']);
run('deno', ['task', 'build:macos:arm64'], { cwd: denoRoot });
run('deno', ['task', 'build:windows:x64'], { cwd: denoRoot });
run('deno', ['task', 'release:prepare'], { cwd: denoRoot });

const releaseLookup = run(
  'gh',
  ['api', `repos/${repository}/releases/tags/${tag}`, '--silent'],
  { capture: true, allowFailure: true },
);

if (releaseLookup.status === 0) {
  console.log(`Adding Deno Desktop assets to existing release ${tag}...`);
  run('gh', [
    'release',
    'upload',
    tag,
    ...ghAssets,
    '--clobber',
    '--repo',
    repository,
  ]);
} else if (releaseLookup.stderr?.includes('HTTP 404')) {
  console.log(`Release ${tag} does not exist; creating it...`);
  run('gh', [
    'release',
    'create',
    tag,
    ...ghAssets,
    '--title',
    `JuRename ${tag}`,
    '--generate-notes',
    '--repo',
    repository,
  ]);
} else {
  if (releaseLookup.stderr) process.stderr.write(releaseLookup.stderr);
  throw new Error(`Unable to check GitHub release ${tag}.`);
}

const release = run(
  'gh',
  ['release', 'view', tag, '--repo', repository, '--json', 'url,assets'],
  { capture: true },
);
const releaseInfo = JSON.parse(release.stdout);
for (const asset of assets) {
  const uploaded = releaseInfo.assets.find((candidate) => candidate.label === asset.label);
  if (!uploaded || uploaded.state !== 'uploaded') {
    throw new Error(`GitHub did not report a completed upload for ${asset.label}.`);
  }
  console.log(`Uploaded: ${asset.label}`);
}
console.log(`Release: ${releaseInfo.url}`);
