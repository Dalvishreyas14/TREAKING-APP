import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /**
       * The `server-only` package throws on import unless the bundler resolves the
       * `react-server` export condition. Vitest runs in plain Node with neither
       * condition, so tests for genuinely server-only modules (tokens, rate
       * limiting, password hashing) would fail at import time. Aliasing it to an
       * empty stub keeps the guard itself intact in the real build - the marker
       * import in the source is what Next.js uses to reject client bundling.
       */
      'server-only': fileURLToPath(
        new URL('./test/stubs/server-only.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // argon2id is deliberately expensive; the default 5s is too tight once the
    // suite hashes real passwords.
    testTimeout: 30_000,
  },
});
