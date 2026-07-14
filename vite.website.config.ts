import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'website',
  base: './',
  build: {
    outDir: resolve(__dirname, 'docs'),
    emptyOutDir: true,
  },
  server: {
    fs: {
      // 官网源文件位于 website/，但应用图标保存在项目根目录。
      allow: [resolve(__dirname)],
    },
  },
});
