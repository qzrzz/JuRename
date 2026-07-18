import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const platform = process.argv[2];
const platformArgs = {
  mac: ['--mac', '--universal'],
  win: ['--win', 'zip', '--x64'],
  linux: ['--linux', 'AppImage', '--x64'],
};
const args = platformArgs[platform];
if (!args) throw new Error('Expected platform: mac, win, or linux');

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, ['scripts/build.mjs']);
const builder = join('node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
run(builder, args);
