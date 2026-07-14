import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

process.loadEnvFile?.('.env');

const projectName = 'jurename-builder-node-modules';
const minimumDockerMemory = 5 * 1024 ** 3;
const notarizationVariables = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const dockerBuild = (script, image) => {
  run('docker', [
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${process.cwd()}:/source:ro`,
    '-v', `${process.cwd()}/release:/output`,
    '-v', `${projectName}:/project/node_modules`,
    '-w', '/project',
    image,
    '/bin/bash', '-lc', [
      'set -e',
      'mkdir -p /project',
      'tar --exclude=node_modules --exclude=release --exclude=dist-electron --exclude=.git -C /source -cf - . | tar -C /project -xf -',
      'rm -f bun.lock',
      'npm install --legacy-peer-deps --package-lock=false',
      `npm run ${script}`,
      'cp -a /project/release/. /output/',
    ].join('; '),
  ]);
};

const dockerInfo = spawnSync('docker', ['info', '--format', '{{.MemTotal}}'], { encoding: 'utf8' });
const dockerMemory = Number(dockerInfo.stdout.trim());
if (dockerInfo.status !== 0 || !Number.isFinite(dockerMemory)) {
  throw new Error('Docker is unavailable. Start OrbStack or Docker Desktop before building release artifacts.');
}
if (dockerMemory < minimumDockerMemory) {
  throw new Error('Docker needs at least 5 GiB of memory for Windows cross-builds. Increase OrbStack or Docker Desktop resources, then retry.');
}
const missingNotarizationVariables = notarizationVariables.filter((name) => !process.env[name]);
if (missingNotarizationVariables.length > 0) {
  throw new Error(`Missing macOS notarization variables in .env: ${missingNotarizationVariables.join(', ')}`);
}

rmSync('release', { recursive: true, force: true });
mkdirSync('release');

run('bun', ['run', 'dist:mac']);
dockerBuild('dist:win', 'electronuserland/builder:wine');
dockerBuild('dist:linux', 'electronuserland/builder');
