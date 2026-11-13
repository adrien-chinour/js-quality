import { describe, expect, it } from 'vite-plus/test';
import { mergeConfig } from '../src/config.ts';
import { mutateGlobs, strykerConfig } from '../src/mutation.ts';

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
  it('runs the project tests through the command runner and breaks under the threshold', () => {
    const config = strykerConfig(mergeConfig({ mutation: { break: 80, command: 'pnpm test' } }), [
      'src/a.ts',
    ]);
    expect(config).toMatchObject({
      testRunner: 'command',
      commandRunner: { command: 'pnpm test' },
      mutate: ['src/a.ts'],
      thresholds: { low: 80, break: 80 },
      disableTypeChecks: false,
      tsconfigFile: '.jsq-no-tsconfig.json',
    });
  });
});
