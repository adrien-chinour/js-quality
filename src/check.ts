import { measureFiles, type FunctionComplexity } from './complexity.ts';
import type { Config } from './config.ts';
import { readLcov, scoreFunctions, type CrapScore } from './crap.ts';
import { detectClones, exceeds, type DuplicationReport } from './duplication.ts';
import { sourceFiles } from './files.ts';

export const GATES = ['complexity', 'crap', 'duplication'] as const;
export type Gate = (typeof GATES)[number];

export interface GateResult {
  gate: Gate;
  passed: boolean;
  /** One line summing the gate up. */
  summary: string;
  /** One line per offending function or clone, worst first. */
  details: string[];
}

function where(fn: FunctionComplexity): string {
  return `${fn.file}:${fn.line}`;
}

export function complexityGate(functions: FunctionComplexity[], limit: number): GateResult {
  const failing = functions
    .filter((fn) => fn.complexity > limit)
    .sort((a, b) => b.complexity - a.complexity);
  return {
    gate: 'complexity',
    passed: failing.length === 0,
    summary:
      failing.length === 0
        ? `${functions.length} function(s) measured, none above ${limit}`
        : `${failing.length} function(s) above cognitive complexity ${limit}: split them`,
    details: failing.map((fn) => `cognitive ${String(fn.complexity).padStart(3)}  ${where(fn)}`),
  };
}

export function crapGate(scores: CrapScore[], limit: number): GateResult {
  const failing = scores.filter((score) => score.crap >= limit);
  return {
    gate: 'crap',
    passed: failing.length === 0,
    summary:
      failing.length === 0
        ? `${scores.length} function(s) scored, none at or above ${limit}`
        : `${failing.length} function(s) at or above CRAP ${limit}: split them, test them, or both`,
    details: failing.map(
      (score) =>
        `crap ${score.crap.toFixed(1).padStart(6)}  cognitive ${String(score.complexity).padStart(2)}  ` +
        `coverage ${(score.coverage * 100).toFixed(0).padStart(3)}%  ${where(score)}`,
    ),
  };
}

export function duplicationGate(report: DuplicationReport, threshold: number): GateResult {
  const passed = !exceeds(report, threshold);
  return {
    gate: 'duplication',
    passed,
    summary: passed
      ? `${report.clones.length} clone(s), ${report.percentage.toFixed(2)}% duplicated (limit ${threshold}%)`
      : `${report.percentage.toFixed(2)}% duplicated, above ${threshold}%: extract the shared code`,
    details: passed
      ? []
      : report.clones.map(
          ({ first, second, lines }) =>
            `${String(lines).padStart(3)} lines  ${first.name}:${first.start}-${first.end}  ` +
            `= ${second.name}:${second.start}-${second.end}`,
        ),
  };
}

/** Runs the selected gates. Complexity is measured once and shared by the complexity and CRAP gates. */
export async function runCheck(
  root: string,
  config: Config,
  gates: readonly Gate[],
): Promise<GateResult[]> {
  const files = await sourceFiles(root, config);
  const needsComplexity = gates.includes('complexity') || gates.includes('crap');
  const functions = needsComplexity ? await measureFiles(root, files) : [];
  const results: GateResult[] = [];
  if (gates.includes('complexity')) results.push(complexityGate(functions, config.complexity));
  if (gates.includes('crap')) {
    results.push(
      crapGate(scoreFunctions(functions, await readLcov(root, config.lcov)), config.crap),
    );
  }
  if (gates.includes('duplication')) {
    results.push(
      duplicationGate(
        await detectClones(root, files, config.duplication),
        config.duplication.threshold,
      ),
    );
  }
  return results;
}

export function formatResults(results: GateResult[]): string {
  return results
    .flatMap((result) => [
      `${result.passed ? '✓' : '✗'} ${result.gate.padEnd(11)} ${result.summary}`,
      ...result.details.map((detail) => `    ${detail}`),
    ])
    .join('\n');
}
