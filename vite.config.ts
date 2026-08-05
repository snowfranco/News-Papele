import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The Vite project root is src/ so the repo root can keep the built,
// committed single-file artifact at ./index.html (GitHub Pages serves it
// from the main branch root). scripts/postbuild.mjs copies dist/index.html
// up after each build.
export default defineConfig({
  root: 'src',
  // Honor a harness-assigned port (PORT env) so local previews never fight
  // over 5173; falls back to the Vite default.
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Single-file output: everything inlined, no chunk splitting.
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
  },
});
