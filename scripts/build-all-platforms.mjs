import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';

process.loadEnvFile?.('.env');

const projectName = 'jurename-builder-node-modules';
const minimumDockerMemory = 2.5 * 1024 ** 3;
const notarizationVariables = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (signal) {
      reject(new Error(`${command} was terminated by ${signal}. Check Docker memory and system resources.`));
    } else if (code !== 0) {
      reject(new Error(`${command} exited with code ${code ?? 1}.`));
    } else {
      resolve();
    }
  });
});

const dockerBuild = (platform, image) => {
  const artifact = platform === 'win'
    ? `JuRename-${version}-win.zip`
    : `JuRename-${version}.AppImage`;

  return run('docker', [
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
      `node scripts/package-platform.mjs ${platform}`,
      `cp /project/release/${artifact} /output/${artifact}`,
    ].join('; '),
  ]);
};

const hasArtifact = (platform) => {
  const files = readdirSync('release', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.includes(version))
    .map((entry) => entry.name);

  if (platform === 'mac') {
    return ['x64', 'arm64'].every((arch) => files.includes(`JuRename-${version}-${arch}-mac.zip`));
  }
  if (platform === 'win') return files.includes(`JuRename-${version}-win.zip`);
  return files.includes(`JuRename-${version}.AppImage`);
};

const buildUnlessComplete = async (platform, build) => {
  if (hasArtifact(platform)) {
    console.log(`Skipping ${platform}: release artifact for v${version} already exists.`);
    return;
  }
  await build();
};

const dockerInfo = spawnSync('docker', ['info', '--format', '{{.MemTotal}}'], { encoding: 'utf8' });
const dockerMemory = Number(dockerInfo.stdout.trim());
if (dockerInfo.status !== 0 || !Number.isFinite(dockerMemory)) {
  throw new Error('Docker is unavailable. Start OrbStack or Docker Desktop before building release artifacts.');
}
if (dockerMemory < minimumDockerMemory) {
  throw new Error(
    `Docker has ${(dockerMemory / 1024 ** 3).toFixed(1)} GiB of memory; `
    + `at least ${(minimumDockerMemory / 1024 ** 3).toFixed(1)} GiB is required. `
    + 'Increase OrbStack or Docker Desktop resources, then retry.'
  );
}
const missingNotarizationVariables = notarizationVariables.filter((name) => !process.env[name]);
if (missingNotarizationVariables.length > 0) {
  throw new Error(`Missing macOS notarization variables in .env: ${missingNotarizationVariables.join(', ')}`);
}

if (process.argv.includes('--check')) process.exit(0);

mkdirSync('release', { recursive: true });

const macBuild = buildUnlessComplete(
  'mac',
  () => run(process.execPath, ['scripts/package-platform.mjs', 'mac']),
);
const dockerBuilds = (async () => {
  await buildUnlessComplete('win', () => dockerBuild('win', 'electronuserland/builder:wine'));
  await buildUnlessComplete('linux', () => dockerBuild('linux', 'electronuserland/builder'));
})();

const results = await Promise.allSettled([macBuild, dockerBuilds]);
const failed = results.find((result) => result.status === 'rejected');
if (failed) throw failed.reason;
