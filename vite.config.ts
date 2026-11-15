import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ['test/fixtures/**', 'dist/**'],
  },
  fmt: {
    singleQuote: true,
    ignorePatterns: ['test/fixtures/**', 'dist/**'],
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Every complexity measure starts Oxlint and loads the SonarJS plugin: about a second, far more
    // on a busy machine or under Stryker's parallel runs.
    testTimeout: 30_000,
    exclude: ['test/fixtures/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    },
  },
  pack: {
    entry: ['src/cli.ts', 'src/sandbox-build.ts'],
    format: ['esm'],
    platform: 'node',
    dts: false,
  },
});
