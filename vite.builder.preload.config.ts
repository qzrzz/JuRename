import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    copyPublicDir: false,
    ssr: 'src/preload.ts',
    rollupOptions: {
      output: {
        format: 'cjs',
        codeSplitting: false,
        entryFileNames: 'preload.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
