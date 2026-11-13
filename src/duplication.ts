import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runJscpd } from 'jscpd';
import type { Config } from './config.ts';

interface Location {
  name: string;
  start: number;
  end: number;
}

export interface Clone {
  first: Location;
  second: Location;
  lines: number;
  tokens: number;
}

export interface DuplicationReport {
  clones: Clone[];
  /** Share of duplicated lines, in percent. */
  percentage: number;
}

interface JscpdReport {
  duplicates: { firstFile: Location; secondFile: Location; lines: number; tokens: number }[];
  statistics: { total: { percentage: number } };
}

/** jscpd runs with `--absolute`: paths come back relative to the project root. */
export function toReport(raw: JscpdReport, root: string): DuplicationReport {
  const location = ({ name, start, end }: Location): Location => ({
    name: relative(root, name),
    start,
    end,
  });
  return {
    clones: raw.duplicates.map((clone) => ({
      first: location(clone.firstFile),
      second: location(clone.secondFile),
      lines: clone.lines,
      tokens: clone.tokens,
    })),
    percentage: raw.statistics.total.percentage,
  };
}

/** Runs jscpd on the given files (relative to the root) and reads its JSON report. */
export async function detectClones(
  root: string,
  files: string[],
  settings: Config['duplication'],
): Promise<DuplicationReport> {
  if (files.length === 0) return { clones: [], percentage: 0 };
  const output = await mkdtemp(join(tmpdir(), 'jsq-jscpd-'));
  try {
    const args = [
      ...files,
      ['--min-tokens', String(settings.minTokens)],
      ['--min-lines', String(settings.minLines)],
      ['--reporters', 'json', '--output', output, '--no-gitignore', '--absolute'],
    ].flat();
    const result = runJscpd(args, { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`jscpd failed: ${result.stderr || result.stdout}`);
    return toReport(JSON.parse(await readFile(join(output, 'jscpd-report.json'), 'utf8')), root);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
}

/** Same rule as `jscpd --threshold`: fails above the threshold, so 0 forbids any clone. */
export function exceeds(report: DuplicationReport, threshold: number): boolean {
  return report.percentage > threshold;
}
