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
    exclude: ['test/fixtures/**', 'node_modules/**'],
    coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['src/**'] },
  },
  pack: {
    entry: ['src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    dts: false,
  },
});
