import { describe, expect, it } from 'vite-plus/test';
import {
  complexityGate,
  crapGate,
  duplicationGate,
  formatResults,
  runCheck,
} from '../src/check.ts';
import { mergeConfig } from '../src/config.ts';

const ROOT = 'test/fixtures/project';
const fn = (file: string, complexity: number) => ({
  file,
  name: 'f',
  line: 1,
  startLine: 1,
  endLine: 3,
  complexity,
});

describe('complexityGate', () => {
  it('passes at the limit and fails above, worst first', () => {
    expect(complexityGate([fn('a.ts', 15)], 15).passed).toBe(true);
    const result = complexityGate([fn('a.ts', 16), fn('b.ts', 20)], 15);
    expect(result.passed).toBe(false);
    expect(result.details).toEqual(['cognitive  20  b.ts:1', 'cognitive  16  a.ts:1']);
  });
});

describe('crapGate', () => {
  it('fails at the limit', () => {
    const score = (crap: number) => ({ ...fn('a.ts', 2), coverage: 0.5, crap });
    expect(crapGate([score(9.9)], 10).passed).toBe(true);
    const result = crapGate([score(10)], 10);
    expect(result.passed).toBe(false);
    expect(result.details).toEqual(['crap   10.0  cognitive  2  coverage  50%  a.ts:1']);
  });
});

describe('duplicationGate', () => {
  it('lists the clones when it fails', () => {
    const at = (name: string) => ({ name, start: 1, end: 9 });
    const result = duplicationGate(
      { clones: [{ first: at('a.ts'), second: at('b.ts'), lines: 9, tokens: 70 }], percentage: 25 },
      0,
    );
    expect(result.passed).toBe(false);
    expect(result.details).toEqual(['  9 lines  a.ts:1-9  = b.ts:1-9']);
  });

  it('passes without clone', () => {
    expect(duplicationGate({ clones: [], percentage: 0 }, 0)).toMatchObject({
      passed: true,
      details: [],
    });
  });
});

describe('complexityGate with a baseline', () => {
  const functions = [
    { ...fn('src/a.ts', 20), name: 'frozen', line: 4 },
    { ...fn('src/a.ts', 18), name: 'worse', line: 9 },
    { ...fn('src/b.ts', 16), name: 'fresh', line: 2 },
  ];

  it('passes when every violation is frozen at its value or above, and says so', () => {
    const result = complexityGate(functions, 15, {
      'src/a.ts:frozen': 20,
      'src/a.ts:worse': 19,
      'src/b.ts:fresh': 16,
    });
    expect(result).toMatchObject({ passed: true, details: [], warnings: [] });
    expect(result.summary).toBe('3 function(s) above cognitive complexity 15, all frozen');
  });

  it('fails on a new violation or a frozen value exceeded, showing the key and the line', () => {
    const result = complexityGate(functions, 15, { 'src/a.ts:frozen': 20, 'src/a.ts:worse': 17 });
    expect(result.passed).toBe(false);
    expect(result.summary).toBe(
      '2 function(s) above cognitive complexity 15: split them (1 more frozen)',
    );
    expect(result.details).toEqual([
      'cognitive  18  src/a.ts:9  src/a.ts:worse: 18 > frozen 17',
      'cognitive  16  src/b.ts:2  src/b.ts:fresh: not frozen',
    ]);
  });

  it('warns about frozen entries that no longer fail, without failing', () => {
    const result = complexityGate([], 15, { 'src/a.ts:gone': 20, 'src/a.ts:renamed': 17 });
    expect(result.passed).toBe(true);
    expect(result.warnings).toEqual([
      '! 2 frozen entry(ies) no longer fail (fixed or renamed): remove them from the baseline',
      '  src/a.ts:gone',
      '  src/a.ts:renamed',
    ]);
  });

  it('gives the violations to freeze', () => {
    expect(complexityGate(functions, 15).violations).toEqual({
      'src/a.ts:frozen': 20,
      'src/a.ts:worse': 18,
      'src/b.ts:fresh': 16,
    });
  });
});

describe('crapGate with a baseline', () => {
  const score = (crap: number) => ({ ...fn('a.ts', 4), coverage: 0, crap });

  it('freezes scores rounded to two decimals and compares them rounded', () => {
    expect(crapGate([score(12.344)], 10).violations).toEqual({ 'a.ts:f': 12.34 });
    expect(crapGate([score(12.344)], 10, { 'a.ts:f': 12.34 }).passed).toBe(true);
    expect(crapGate([score(12.346)], 10, { 'a.ts:f': 12.34 }).details).toEqual([
      'crap   12.3  cognitive  4  coverage   0%  a.ts:1  a.ts:f: 12.35 > frozen 12.34',
    ]);
  });
});

describe('duplicationGate with a baseline', () => {
  const clone = (a: string, b: string, start = 1) => ({
    first: { name: a, start, end: start + 8 },
    second: { name: b, start, end: start + 8 },
    lines: 9,
    tokens: 70,
  });
  const report = (...clones: ReturnType<typeof clone>[]) => ({ clones, percentage: 20 });

  it('freezes the number of clones of each pair of files, whatever their lines and order', () => {
    const frozen = duplicationGate(report(clone('b.ts', 'a.ts', 30), clone('a.ts', 'a.ts')), 0);
    expect(frozen.violations).toEqual({ 'a.ts <> a.ts': 1, 'a.ts <> b.ts': 1 });
    const moved = duplicationGate(
      report(clone('a.ts', 'b.ts', 50), clone('a.ts', 'a.ts', 7)),
      0,
      frozen.violations,
    );
    expect(moved).toMatchObject({ passed: true, details: [], warnings: [] });
    expect(moved.summary).toBe('2 clone pair(s) of files above 0%, all frozen');
  });

  it('fails on a new clone, even in a file holding a frozen one', () => {
    const frozen = { 'a.ts <> b.ts': 1 };
    const result = duplicationGate(report(clone('a.ts', 'b.ts'), clone('a.ts', 'c.ts')), 0, frozen);
    expect(result.passed).toBe(false);
    expect(result.details).toEqual(['  9 lines  a.ts:1-9  = c.ts:1-9  a.ts <> c.ts: not frozen']);
    const twice = duplicationGate(
      report(clone('a.ts', 'b.ts'), clone('b.ts', 'a.ts', 20)),
      0,
      frozen,
    );
    expect(twice.passed).toBe(false);
    expect(twice.details).toEqual([
      '  9 lines  a.ts:1-9  = b.ts:1-9  a.ts <> b.ts: 2 > frozen 1',
      '  9 lines  b.ts:20-28  = a.ts:20-28',
    ]);
  });

  it('keeps frozen pairs without warning while the rate stays under the threshold', () => {
    const result = duplicationGate(report(clone('a.ts', 'b.ts')), 50, { 'a.ts <> b.ts': 1 });
    expect(result).toMatchObject({ passed: true, warnings: [] });
  });

  it('has nothing to freeze under the threshold', () => {
    expect(duplicationGate(report(clone('a.ts', 'b.ts')), 50).violations).toEqual({});
  });
});

describe('runCheck', () => {
  const config = mergeConfig({ lcov: 'lcov.info' });

  it('runs every gate on the project, test files left out', async () => {
    const results = await runCheck(ROOT, config, ['complexity', 'crap', 'duplication']);
    expect(results.map(({ gate, passed }) => [gate, passed])).toEqual([
      ['complexity', true],
      ['crap', false],
      ['duplication', false],
    ]);
    expect(results[1].details[0]).toContain('src/complex.ts:1');
  });

  it('fails the complexity gate under a lower limit', async () => {
    const [result] = await runCheck(ROOT, mergeConfig({ complexity: 10 }), ['complexity']);
    expect(result.passed).toBe(false);
    expect(result.details).toEqual(['cognitive  12  src/complex.ts:1']);
  });

  it('passes on code that is simple, tested and unique', async () => {
    const results = await runCheck(
      ROOT,
      mergeConfig({ lcov: 'lcov.info', src: ['src/clean.ts'] }),
      ['complexity', 'crap', 'duplication'],
    );
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('fails when no source file matches, rather than passing on nothing', async () => {
    await expect(
      runCheck(ROOT, mergeConfig({ src: ['packages/*/src/**/*.ts'] }), ['duplication']),
    ).rejects.toThrow('no source file matches src: packages/*/src/**/*.ts');
  });

  it('passes every gate once its violations are frozen', async () => {
    const gates = ['complexity', 'crap', 'duplication'] as const;
    const first = await runCheck(ROOT, config, gates);
    const baseline = Object.fromEntries(first.map((result) => [result.gate, result.violations]));
    expect(baseline.crap).toEqual({ 'src/complex.ts:classify': 156 });
    expect(baseline.duplication).toEqual({ 'src/dup-a.ts <> src/dup-b.ts': 1 });
    const results = await runCheck(ROOT, config, gates, baseline);
    expect(results.every((result) => result.passed)).toBe(true);
  });

  it('needs no coverage report without the CRAP gate', async () => {
    const results = await runCheck(ROOT, mergeConfig({ lcov: 'missing.info' }), ['complexity']);
    expect(results).toHaveLength(1);
  });
});

describe('formatResults', () => {
  it('prints one line per gate and indents the details, then the warnings', () => {
    const output = formatResults([
      {
        gate: 'crap',
        passed: false,
        summary: 'bad',
        details: ['x'],
        warnings: ['! w'],
        violations: {},
      },
      {
        gate: 'duplication',
        passed: true,
        summary: 'good',
        details: [],
        warnings: [],
        violations: {},
      },
    ]);
    expect(output).toBe('✗ crap        bad\n    x\n    ! w\n✓ duplication good');
  });
});
