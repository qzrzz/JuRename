import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'icon.png');
const assets = join(root, 'assets');
const iconset = mkdtempSync(join(tmpdir(), 'jurename-icons-'));

const pngTargets = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function png(name) {
  return readFileSync(join(iconset, name));
}

function createIcns() {
  const entries = [
    ['icp4', 'icon_16x16.png'],
    ['icp5', 'icon_32x32.png'],
    ['icp6', 'icon_32x32@2x.png'],
    ['ic07', 'icon_128x128.png'],
    ['ic08', 'icon_256x256.png'],
    ['ic09', 'icon_512x512.png'],
    ['ic10', 'icon_512x512@2x.png'],
  ].map(([type, name]) => [type, png(name)]);

  const chunks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  writeFileSync(join(assets, 'icon.icns'), Buffer.concat([header, ...chunks]));
}

function createIco() {
  const entries = [
    [16, 'icon_16x16.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_256x256.png'],
  ].map(([size, name]) => [size, png(name)]);

  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(([size, data], index) => {
    const position = 6 + index * 16;
    header[position] = size === 256 ? 0 : size;
    header[position + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(data.length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += data.length;
  });
  writeFileSync(join(assets, 'icon.ico'), Buffer.concat([header, ...entries.map(([, data]) => data)]));
}

try {
  mkdirSync(assets, { recursive: true });
  for (const [name, size] of pngTargets) {
    execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', join(iconset, name)], {
      stdio: 'ignore',
    });
  }
  copyFileSync(source, join(assets, 'icon.png'));
  createIcns();
  createIco();
  console.log('Generated assets/icon.png, assets/icon.icns and assets/icon.ico');
} finally {
  rmSync(iconset, { recursive: true, force: true });
}
