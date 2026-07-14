import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const projectName = 'jurename-builder-node-modules';
const minimumDockerMemory = 6 * 1024 ** 3;

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const dockerBuild = (script, image) => {
  run('docker', [
    'run', '--rm', '--platform', 'linux/amd64',
    '-v', `${process.cwd()}:/project`,
    '-v', `${projectName}:/project/node_modules`,
    '-w', '/project',
    image,
    '/bin/bash', '-lc', [
      'set -e',
      'mv bun.lock .bun.lock.docker',
      "trap 'mv .bun.lock.docker bun.lock' EXIT",
      'npm install --legacy-peer-deps --package-lock=false',
      `npm run ${script}`,
    ].join('; '),
  ]);
};

const dockerInfo = spawnSync('docker', ['info', '--format', '{{.MemTotal}}'], { encoding: 'utf8' });
const dockerMemory = Number(dockerInfo.stdout.trim());
if (dockerInfo.status !== 0 || !Number.isFinite(dockerMemory)) {
  throw new Error('Docker is unavailable. Start OrbStack or Docker Desktop before building release artifacts.');
}
if (dockerMemory < minimumDockerMemory) {
  throw new Error('Docker needs at least 6 GB of memory for Windows cross-builds. Increase OrbStack or Docker Desktop resources, then retry.');
}

rmSync('release', { recursive: true, force: true });

run('bun', ['run', 'dist:mac']);
dockerBuild('dist:win', 'electronuserland/builder:wine');
dockerBuild('dist:linux', 'electronuserland/builder');
