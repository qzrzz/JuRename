import { defineConfig } from 'vite';

export default defineConfig({
  ssr: {
    noExternal: ['chalk'],
  },
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    copyPublicDir: false,
    ssr: 'src/main.ts',
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'main.js',
      },
    },
  },
});
