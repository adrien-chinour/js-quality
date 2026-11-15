import { compareToBaseline, type Baseline, type Section } from './baseline.ts';
import { measureFiles, type FunctionComplexity } from './complexity.ts';
import type { Config } from './config.ts';
import { readLcov, scoreFunctions, type CrapScore } from './crap.ts';
import { detectClones, exceeds, type Clone, type DuplicationReport } from './duplication.ts';
import { sourceFiles } from './files.ts';
import type { Gate } from './gates.ts';

export { GATES, type Gate } from './gates.ts';

export interface GateResult {
  gate: Gate;
  passed: boolean;
  /** One line summing the gate up. */
  summary: string;
  /** One line per offending function or clone, worst first. */
  details: string[];
  /** Frozen entries that no longer violate the gate; they do not fail it. */
  warnings: string[];
  /** Every current violation and its value, frozen or not: what `--write-baseline` writes. */
  violations: Section;
}

/** One violation of a gate: a function, or the clones of a pair of files. */
interface Violation {
  key: string;
  value: number;
  /** Lines describing it, the first one holding its location. */
  lines: string[];
}

interface Verdict {
  gate: Gate;
  violations: Violation[];
  /** Summary when nothing violates the gate. */
  clean: string;
  /** Summary when `count` violations fail the gate. */
  failed: (count: number) => string;
  /** What the violations are, as in "3 <what>, all frozen". */
  what: string;
}

function withoutBaseline(verdict: Verdict): Pick<GateResult, 'passed' | 'summary' | 'details'> {
  const count = verdict.violations.length;
  return {
    passed: count === 0,
    summary: count === 0 ? verdict.clean : verdict.failed(count),
    details: verdict.violations.flatMap((violation) => violation.lines),
  };
}

function againstBaseline(
  verdict: Verdict,
  frozen: Section,
  current: Section,
): Pick<GateResult, 'passed' | 'summary' | 'details' | 'warnings'> {
  const { failing, stale } = compareToBaseline(current, frozen);
  const failed = new Set(failing);
  const tolerated = verdict.violations.length - failing.length;
  const details = verdict.violations
    .filter((violation) => failed.has(violation.key))
    .flatMap(({ key, value, lines: [first, ...rest] }) => {
      const status = frozen[key] === undefined ? 'not frozen' : `${value} > frozen ${frozen[key]}`;
      return [`${first}  ${key}: ${status}`, ...rest];
    });
  const warnings =
    stale.length === 0
      ? []
      : [
          `! ${stale.length} frozen entry(ies) no longer fail (fixed or renamed): remove them from the baseline`,
          ...stale.map((key) => `  ${key}`),
        ];
  let summary = verdict.clean;
  if (failing.length > 0) {
    summary = verdict.failed(failing.length) + (tolerated > 0 ? ` (${tolerated} more frozen)` : '');
  } else if (tolerated > 0) {
    summary = `${tolerated} ${verdict.what}, all frozen`;
  }
  return { passed: failing.length === 0, summary, details, warnings };
}

/** Judges the violations of a gate; without baseline, any violation fails it. */
function judge(verdict: Verdict, frozen: Section | undefined): GateResult {
  const violations = Object.fromEntries(verdict.violations.map(({ key, value }) => [key, value]));
  const outcome =
    frozen === undefined
      ? { ...withoutBaseline(verdict), warnings: [] }
      : againstBaseline(verdict, frozen, violations);
  return { gate: verdict.gate, ...outcome, violations };
}

function where(fn: FunctionComplexity): string {
  return `${fn.file}:${fn.line}`;
}

/** Key of a function in the baseline: no line number, so code added above it does not unfreeze it. */
function functionKey(fn: FunctionComplexity): string {
  return `${fn.file}:${fn.name}`;
}

export function complexityGate(
  functions: FunctionComplexity[],
  limit: number,
  frozen?: Section,
): GateResult {
  const violations = functions
    .filter((fn) => fn.complexity > limit)
    .sort((a, b) => b.complexity - a.complexity)
    .map((fn) => ({
      key: functionKey(fn),
      value: fn.complexity,
      lines: [`cognitive ${String(fn.complexity).padStart(3)}  ${where(fn)}`],
    }));
  const what = `function(s) above cognitive complexity ${limit}`;
  return judge(
    {
      gate: 'complexity',
      violations,
      clean: `${functions.length} function(s) measured, none above ${limit}`,
      failed: (count) => `${count} ${what}: split them`,
      what,
    },
    frozen,
  );
}

const round = (score: number) => Math.round(score * 100) / 100;

export function crapGate(scores: CrapScore[], limit: number, frozen?: Section): GateResult {
  const violations = scores
    .filter((score) => score.crap >= limit)
    .map((score) => ({
      key: functionKey(score),
      value: round(score.crap),
      lines: [
        `crap ${score.crap.toFixed(1).padStart(6)}  cognitive ${String(score.complexity).padStart(2)}  ` +
          `coverage ${(score.coverage * 100).toFixed(0).padStart(3)}%  ${where(score)}`,
      ],
    }));
  const what = `function(s) at or above CRAP ${limit}`;
  return judge(
    {
      gate: 'crap',
      violations,
      clean: `${scores.length} function(s) scored, none at or above ${limit}`,
      failed: (count) => `${count} ${what}: split them, test them, or both`,
      what,
    },
    frozen,
  );
}

/** Key of a clone in the baseline: its pair of files, in either order and without lines. */
function pairKey({ first, second }: Clone): string {
  return [first.name, second.name].sort().join(' <> ');
}

/** The clones grouped by pair of files, a violation each, valued by its number of clones. */
function clonePairs(clones: Clone[]): Violation[] {
  const pairs = new Map<string, Violation>();
  for (const clone of clones) {
    const key = pairKey(clone);
    const pair = pairs.get(key) ?? { key, value: 0, lines: [] };
    pair.value += 1;
    pair.lines.push(
      `${String(clone.lines).padStart(3)} lines  ${clone.first.name}:${clone.first.start}-${clone.first.end}  ` +
        `= ${clone.second.name}:${clone.second.start}-${clone.second.end}`,
    );
    pairs.set(key, pair);
  }
  return [...pairs.values()];
}

export function duplicationGate(
  report: DuplicationReport,
  threshold: number,
  frozen?: Section,
): GateResult {
  const duplicated = `${report.percentage.toFixed(2)}% duplicated`;
  const above = exceeds(report, threshold);
  return judge(
    {
      gate: 'duplication',
      violations: above ? clonePairs(report.clones) : [],
      clean: `${report.clones.length} clone(s), ${duplicated} (limit ${threshold}%)`,
      failed: () => `${duplicated}, above ${threshold}%: extract the shared code`,
      what: `clone pair(s) of files above ${threshold}%`,
    },
    // Under the threshold the clones still exist: their frozen pairs are not stale.
    above ? frozen : undefined,
  );
}

/** Runs the selected gates. Complexity is measured once and shared by the complexity and CRAP gates. */
export async function runCheck(
  root: string,
  config: Config,
  gates: readonly Gate[],
  baseline?: Baseline,
): Promise<GateResult[]> {
  // With a baseline, a gate it has no section for has nothing frozen; without one, nothing changes.
  const frozen = (gate: Gate) => (baseline === undefined ? undefined : (baseline[gate] ?? {}));
  const files = await sourceFiles(root, config);
  // An empty set would pass every gate without checking anything (a monorepo root, a typo in src).
  if (files.length === 0) throw new Error(`no source file matches src: ${config.src.join(', ')}`);
  const needsComplexity = gates.includes('complexity') || gates.includes('crap');
  const functions = needsComplexity ? await measureFiles(root, files) : [];
  const results: GateResult[] = [];
  if (gates.includes('complexity'))
    results.push(complexityGate(functions, config.complexity, frozen('complexity')));
  if (gates.includes('crap')) {
    results.push(
      crapGate(
        scoreFunctions(functions, await readLcov(root, config.lcov)),
        config.crap,
        frozen('crap'),
      ),
    );
  }
  if (gates.includes('duplication')) {
    results.push(
      duplicationGate(
        await detectClones(root, files, config.duplication),
        config.duplication.threshold,
        frozen('duplication'),
      ),
    );
  }
  return results;
}

export function formatResults(results: GateResult[]): string {
  return results
    .flatMap((result) => [
      `${result.passed ? '✓' : '✗'} ${result.gate.padEnd(11)} ${result.summary}`,
      ...[...result.details, ...result.warnings].map((line) => `    ${line}`),
    ])
    .join('\n');
}
