import { describe, expect, it, vi } from 'vite-plus/test';
import { measureSource } from '../src/complexity.ts';

// Oxlint's report, faked: these cases cannot be produced by the real Oxlint on demand.
const report = vi.hoisted(() => ({ value: {} as object }));

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: null, result: { stdout: string }) => void;
    callback(null, { stdout: JSON.stringify(report.value) });
  },
}));

const SOURCE = 'export function f(x) {\n  return x ? 1 : 0;\n}\n';
const DIAGNOSTIC = {
  message: 'Refactor this function to reduce its Cognitive Complexity from 1 to the 0 allowed.',
  labels: [{ span: { line: 1 } }],
};

describe('measureSource against the Oxlint report', () => {
  it('gives the original path back', async () => {
    report.value = { number_of_files: 1, diagnostics: [{ ...DIAGNOSTIC, filename: '0.jsx' }] };
    expect(await measureSource('src/f.js', SOURCE)).toMatchObject([
      { file: 'src/f.js', line: 1, complexity: 1, startLine: 1, endLine: 3 },
    ]);
  });

  it('fails when Oxlint skipped a file', async () => {
    report.value = { number_of_files: 0, diagnostics: [] };
    await expect(measureSource('src/f.js', SOURCE)).rejects.toThrow('oxlint linted 0 of 1 file(s)');
  });

  it('fails on a diagnostic for a file it did not copy', async () => {
    report.value = { number_of_files: 1, diagnostics: [{ ...DIAGNOSTIC, filename: './0.jsx' }] };
    await expect(measureSource('src/f.js', SOURCE)).rejects.toThrow(
      'oxlint reported an unknown file: ./0.jsx',
    );
  });
});
