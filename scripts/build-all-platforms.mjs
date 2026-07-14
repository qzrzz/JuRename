import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const projectName = 'jurename-builder-node-modules';

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
    '/bin/bash', '-lc', `npm install --legacy-peer-deps --package-lock=false && npm run ${script}`,
  ]);
};

rmSync('release', { recursive: true, force: true });

run('bun', ['run', 'dist:mac']);
dockerBuild('dist:win', 'electronuserland/builder:wine');
dockerBuild('dist:linux', 'electronuserland/builder');
