import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works at https://<user>.github.io/<repo>/ or any other folder.
  base: './',
  plugins: [svelte()],
})
