import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { FunctionComplexity } from './complexity.ts';

export type LineHits = Map<number, number>;

export interface CrapScore extends FunctionComplexity {
  coverage: number;
  crap: number;
}

/** CRAP formula, with cognitive complexity in place of cyclomatic complexity. */
export function crapScore(complexity: number, coverage: number): number {
  return complexity ** 2 * (1 - coverage) ** 3 + complexity;
}

/** Hit count of each line, per source file of an LCOV report, keyed by path relative to the root. */
export function parseLcov(text: string, root: string): Map<string, LineHits> {
  const files = new Map<string, LineHits>();
  let lines: LineHits = new Map();
  for (const record of text.split('\n')) {
    if (record.startsWith('SF:')) {
      const path = record.slice(3).trim();
      lines = new Map();
      files.set(relative(root, isAbsolute(path) ? path : resolve(root, path)), lines);
    } else if (record.startsWith('DA:')) {
      const [line, hits] = record.slice(3).split(',');
      lines.set(Number(line), Number(hits));
    }
  }
  return files;
}

/** Share of the instrumented lines hit. A function absent from the report was never loaded: uncovered. */
export function lineCoverage(
  hits: LineHits | undefined,
  startLine: number,
  endLine: number,
): number {
  if (!hits) return 0;
  let total = 0;
  let hit = 0;
  for (let line = startLine; line <= endLine; line += 1) {
    const count = hits.get(line);
    if (count === undefined) continue;
    total += 1;
    if (count > 0) hit += 1;
  }
  return total === 0 ? 0 : hit / total;
}

export function scoreFunctions(
  functions: FunctionComplexity[],
  lcov: Map<string, LineHits>,
): CrapScore[] {
  const scores = functions.map((fn) => {
    const coverage = lineCoverage(lcov.get(fn.file), fn.startLine, fn.endLine);
    return { ...fn, coverage, crap: crapScore(fn.complexity, coverage) };
  });
  return scores.sort((a, b) => b.crap - a.crap);
}

export async function readLcov(root: string, path: string): Promise<Map<string, LineHits>> {
  let text: string;
  try {
    text = await readFile(resolve(root, path), 'utf8');
  } catch {
    throw new Error(`no coverage report at ${path}: run \`vp test run --coverage\` first`);
  }
  return parseLcov(text, root);
}
