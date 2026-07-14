import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const bun = process.platform === 'win32' ? 'bun.exe' : 'bun';
const electron = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const electronBin = join('node_modules', '.bin', electron);
const devServerUrl = 'http://127.0.0.1:5173';

const build = spawnSync(bun, ['run', 'build:main'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const preload = spawnSync(bun, ['run', 'build:preload'], { stdio: 'inherit' });
if (preload.status !== 0) process.exit(preload.status ?? 1);

const vite = spawn(bun, ['x', 'vite', '--config', 'vite.builder.renderer.config.ts', '--host', '127.0.0.1'], {
  stdio: 'inherit',
});

const waitForDevServer = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(devServerUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Vite development server did not start.');
};

let app;
try {
  await waitForDevServer();
  app = spawn(electronBin, ['dist-electron/main.js'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
  });
} catch (error) {
  console.error(error);
  vite.kill();
  process.exitCode = 1;
}

const shutdown = () => {
  app?.kill();
  vite.kill();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
app?.on('exit', shutdown);
vite.on('exit', (code) => {
  if (code && code !== 0) process.exitCode = code;
});
