import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.ts';

const require = createRequire(import.meta.url);

/** Script that prepares Stryker's sandbox: next to this module, `.ts` in the sources, `.mjs` once built. */
const SANDBOX_BUILD = fileURLToPath(
  new URL(`sandbox-build${extname(import.meta.url)}`, import.meta.url),
);

/** A command line as Stryker splits it: on spaces, unless escaped. */
export const commandLine = (...words: string[]) =>
  words.map((word) => word.replaceAll(' ', '\\ ')).join(' ');

/** Files Stryker mutates: the given ones, else the gates' sources minus their ignores. */
export function mutateGlobs(config: Config, only: string[]): string[] {
  if (only.length > 0) return only;
  if (config.mutation.mutate.length > 0) return config.mutation.mutate;
  return [...config.src, ...config.ignore.map((glob) => `!${glob}`)];
}

/**
 * How Stryker runs the tests. By default, the Vitest runner jsq embeds, loaded by absolute path so the project
 * needs no Stryker plugin, with per-test coverage: each mutant runs only the tests that cover it. With
 * `mutation.command`, the command runner runs that command for every mutant, whatever runs the tests.
 */
function testRunner(command: string | undefined): Record<string, unknown> {
  if (command) {
    return { testRunner: 'command', commandRunner: { command }, coverageAnalysis: 'off' };
  }
  return {
    testRunner: 'vitest',
    plugins: [require.resolve('@stryker-mutator/vitest-runner')],
    coverageAnalysis: 'perTest',
  };
}

/** Stryker configuration. */
export function strykerConfig(config: Config, only: string[]): Record<string, unknown> {
  const { command, break: breaking } = config.mutation;
  return {
    ...testRunner(command),
    mutate: mutateGlobs(config, only),
    reporters: ['clear-text', 'progress'],
    // Stryker refuses a high threshold under the low one.
    thresholds: { high: Math.max(90, breaking), low: breaking, break: breaking },
    tempDirName: '.stryker-tmp',
    // Tests run through esbuild, which strips types: no `// @ts-nocheck` that would shift line numbers.
    disableTypeChecks: false,
    // Stryker rewrites tsconfig.json with the project's TypeScript API, which TypeScript 7 no longer
    // ships: point it at a file that does not exist, and rewrite the paths that leave the sandbox
    // (`"extends": "../../tsconfig.base.json"` in a monorepo package) with jsq's own script. Vitest
    // reads them too: without the rewrite, it fails to load such a tsconfig in the sandbox.
    tsconfigFile: '.jsq-no-tsconfig.json',
    buildCommand: commandLine(process.execPath, SANDBOX_BUILD),
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
    // The project's binaries (vp, vitest…) must be found by mutation.command.
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
