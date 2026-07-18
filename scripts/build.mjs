import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const vite = join('node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const configs = {
  main: 'vite.builder.main.config.ts',
  preload: 'vite.builder.preload.config.ts',
  renderer: 'vite.builder.renderer.config.ts',
};
const targets = process.argv.slice(2);
const selected = targets.length === 0 ? Object.keys(configs) : targets;

for (const target of selected) {
  const config = configs[target];
  if (!config) throw new Error(`Unknown build target: ${target}`);

  const result = spawnSync(vite, ['build', '--config', config], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
