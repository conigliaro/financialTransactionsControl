import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    deps: {
      // This is a more aggressive inline strategy that might help with module resolution issues
      // It attempts to inline all dependencies
      inline: true,
    },
  },
});
