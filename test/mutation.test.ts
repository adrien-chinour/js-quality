import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { mergeConfig } from '../src/config.ts';
import { commandLine, mutateGlobs, strykerConfig } from '../src/mutation.ts';

const require = createRequire(import.meta.url);

describe('mutateGlobs', () => {
  it('mutates the sources minus the ignored files by default', () => {
    const config = mergeConfig({ src: ['src/**/*.ts'], ignore: ['**/*.test.*'] });
    expect(mutateGlobs(config, [])).toEqual(['src/**/*.ts', '!**/*.test.*']);
  });

  it('prefers the files given on the command line, then the configured ones', () => {
    const config = mergeConfig({ mutation: { mutate: ['src/a.ts'] } });
    expect(mutateGlobs(config, ['src/b.ts'])).toEqual(['src/b.ts']);
    expect(mutateGlobs(config, [])).toEqual(['src/a.ts']);
  });
});

describe('strykerConfig', () => {
  it('runs the tests with the Vitest runner jsq embeds, with per-test coverage, by default', () => {
    const config = strykerConfig(mergeConfig({ mutation: { break: 80 } }), ['src/a.ts']);
    expect(config).toMatchObject({
      testRunner: 'vitest',
      coverageAnalysis: 'perTest',
      mutate: ['src/a.ts'],
      thresholds: { low: 80, break: 80 },
      disableTypeChecks: false,
      tsconfigFile: '.jsq-no-tsconfig.json',
    });
    expect(config).not.toHaveProperty('commandRunner');
    // Loaded by absolute path: the project declares no Stryker plugin.
    expect(config.plugins).toEqual([require.resolve('@stryker-mutator/vitest-runner')]);
    expect(isAbsolute((config.plugins as string[])[0])).toBe(true);
  });

  it('runs the project command through the command runner when mutation.command is set', () => {
    const config = strykerConfig(mergeConfig({ mutation: { command: 'pnpm test' } }), []);
    expect(config).toMatchObject({
      testRunner: 'command',
      commandRunner: { command: 'pnpm test' },
      coverageAnalysis: 'off',
    });
    expect(config).not.toHaveProperty('plugins');
  });

  it('keeps the high threshold at or above the break threshold', () => {
    expect(strykerConfig(mergeConfig(), []).thresholds).toEqual({ high: 90, low: 70, break: 70 });
    expect(strykerConfig(mergeConfig({ mutation: { break: 95 } }), []).thresholds).toEqual({
      high: 95,
      low: 95,
      break: 95,
    });
  });

  it('rewrites the sandbox tsconfig files with jsq own script, not TypeScript', () => {
    const { buildCommand, tempDirName } = strykerConfig(mergeConfig(), []);
    // The script climbs two levels out of `<root>/.stryker-tmp/sandbox-…`.
    expect(tempDirName).toBe('.stryker-tmp');
    const script = fileURLToPath(new URL('../src/sandbox-build.ts', import.meta.url));
    expect(buildCommand).toBe(commandLine(process.execPath, script));
  });
});

describe('commandLine', () => {
  it('escapes the spaces Stryker would split on', () => {
    expect(commandLine('/opt/my node/node', '/a b/build.ts')).toBe(
      '/opt/my\\ node/node /a\\ b/build.ts',
    );
  });
});
