import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Config {
  /** Globs of the source files the gates measure, relative to the project root. */
  src: string[];
  /** Globs left out of every gate. */
  ignore: string[];
  /** Highest cognitive complexity allowed for one function. */
  complexity: number;
  /** A function fails when its CRAP score reaches this limit. */
  crap: number;
  /** Path of the LCOV report the CRAP gate reads. */
  lcov: string;
  /** Path of the baseline of frozen violations, relative to the project root. */
  baseline: string;
  duplication: { minTokens: number; minLines: number; threshold: number };
  mutation: { command: string; break: number; mutate: string[] };
}

export const defaults: Config = {
  src: ['src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
  ignore: ['**/*.d.ts', '**/*.test.*', '**/*.spec.*', '**/node_modules/**', '**/dist/**'],
  complexity: 15,
  crap: 10,
  lcov: 'coverage/lcov.info',
  baseline: 'jsq-baseline.json',
  duplication: { minTokens: 40, minLines: 4, threshold: 0 },
  mutation: { command: 'vp test run', break: 70, mutate: [] },
};

type Overrides = Partial<Omit<Config, 'duplication' | 'mutation'>> & {
  duplication?: Partial<Config['duplication']>;
  mutation?: Partial<Config['mutation']>;
};

/** Merges the optional `jsq` block of the project's package.json over the defaults. */
export function mergeConfig(overrides: Overrides = {}): Config {
  return {
    ...defaults,
    ...overrides,
    duplication: { ...defaults.duplication, ...overrides.duplication },
    mutation: { ...defaults.mutation, ...overrides.mutation },
  };
}

export async function loadConfig(root: string): Promise<Config> {
  let manifest: { jsq?: Overrides };
  try {
    manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  } catch {
    return mergeConfig();
  }
  return mergeConfig(manifest.jsq);
}
