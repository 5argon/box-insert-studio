import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works at https://<user>.github.io/<repo>/ or any other folder.
  base: './',
  // three.js is ~150 kB gzipped and only loaded when the 3D view opens, so its size is expected.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [svelte()],
})
