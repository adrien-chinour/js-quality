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

  it('needs no coverage report without the CRAP gate', async () => {
    const results = await runCheck(ROOT, mergeConfig({ lcov: 'missing.info' }), ['complexity']);
    expect(results).toHaveLength(1);
  });
});

describe('formatResults', () => {
  it('prints one line per gate and indents the details', () => {
    const output = formatResults([
      { gate: 'crap', passed: false, summary: 'bad', details: ['x'] },
      { gate: 'duplication', passed: true, summary: 'good', details: [] },
    ]);
    expect(output).toBe('✗ crap        bad\n    x\n✓ duplication good');
  });
});
