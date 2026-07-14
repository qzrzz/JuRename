import { spawnSync } from 'node:child_process';

const versionArgs = process.argv.slice(2);
const versionBump = versionArgs.length === 0 ? ['patch'] : versionArgs;

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npm', ['version', ...versionBump]);
run('git', ['push', '--follow-tags']);
