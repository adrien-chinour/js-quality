import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { Config } from './config.ts';

const require = createRequire(import.meta.url);

/** Files Stryker mutates: the given ones, else the gates' sources minus their ignores. */
export function mutateGlobs(config: Config, only: string[]): string[] {
  if (only.length > 0) return only;
  if (config.mutation.mutate.length > 0) return config.mutation.mutate;
  return [...config.src, ...config.ignore.map((glob) => `!${glob}`)];
}

/**
 * Stryker configuration. The command runner runs the project's own tests, whatever runs them,
 * so the project needs no Stryker plugin of its own.
 */
export function strykerConfig(config: Config, only: string[]): Record<string, unknown> {
  return {
    testRunner: 'command',
    commandRunner: { command: config.mutation.command },
    mutate: mutateGlobs(config, only),
    reporters: ['clear-text', 'progress'],
    thresholds: { high: 90, low: config.mutation.break, break: config.mutation.break },
    tempDirName: '.stryker-tmp',
    // Tests run through esbuild, which strips types: no `// @ts-nocheck` that would shift line numbers.
    disableTypeChecks: false,
    // Stryker rewrites tsconfig.json with the project's TypeScript API, which TypeScript 7 no longer
    // ships. Tests run through esbuild and need no rewrite: point it at a file that does not exist.
    tsconfigFile: '.jsq-no-tsconfig.json',
    cleanTempDir: true,
  };
}

/** Runs Stryker in the project and returns its exit code (non-zero below the break threshold). */
export async function runMutation(root: string, config: Config, only: string[]): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'jsq-stryker-'));
  const configFile = join(directory, 'stryker.config.json');
  try {
    await writeFile(configFile, JSON.stringify(strykerConfig(config, only), null, 2));
    const stryker = join(
      dirname(require.resolve('@stryker-mutator/core/package.json')),
      'bin',
      'stryker.js',
    );
    // The project's binaries (vp, vitest…) must be found by the test command.
    const path = [join(root, 'node_modules', '.bin'), process.env.PATH].join(delimiter);
    const result = spawnSync(process.execPath, [stryker, 'run', configFile], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PATH: path },
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
