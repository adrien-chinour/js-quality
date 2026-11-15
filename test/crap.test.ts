import { describe, expect, it } from 'vite-plus/test';
import { crapScore, lineCoverage, parseLcov, readLcov, scoreFunctions } from '../src/crap.ts';

const LCOV = `SF:/repo/src/a.ts  
DA:1,1
DA:2,0
DA:3,4
end_of_record
SF:src/b.ts
DA:1,0
end_of_record
`;

describe('crapScore', () => {
  it('equals the complexity when fully covered', () => {
    expect(crapScore(5, 1)).toBe(5);
  });

  it('grows with the square of the complexity when uncovered', () => {
    expect(crapScore(5, 0)).toBe(30);
  });
});

describe('parseLcov', () => {
  it('keys files by path relative to the root, absolute or not, trailing spaces trimmed', () => {
    const files = parseLcov(LCOV, '/repo');
    expect([...files.keys()]).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files.get('src/a.ts')).toEqual(
      new Map([
        [1, 1],
        [2, 0],
        [3, 4],
      ]),
    );
  });
});

describe('lineCoverage', () => {
  const hits = parseLcov(LCOV, '/repo').get('src/a.ts');

  it('is the share of instrumented lines hit', () => {
    expect(lineCoverage(hits, 1, 3)).toBeCloseTo(2 / 3);
  });

  it('leaves the lines without instrumentation out of the share', () => {
    expect(lineCoverage(hits, 1, 6)).toBeCloseTo(2 / 3);
  });

  it('is 0 for a file absent from the report or a range without instrumented line', () => {
    expect(lineCoverage(undefined, 1, 3)).toBe(0);
    expect(lineCoverage(hits, 10, 12)).toBe(0);
  });
});

describe('scoreFunctions', () => {
  it('scores each function and sorts the worst first', () => {
    const lcov = parseLcov(LCOV, '/repo');
    const scores = scoreFunctions(
      [
        { file: 'src/a.ts', name: 'a', line: 1, startLine: 1, endLine: 3, complexity: 2 },
        { file: 'src/b.ts', name: 'b', line: 1, startLine: 1, endLine: 1, complexity: 3 },
      ],
      lcov,
    );
    expect(scores.map((score) => score.file)).toEqual(['src/b.ts', 'src/a.ts']);
    expect(scores[0].crap).toBe(12);
    expect(scores[1].crap).toBeCloseTo(2 ** 2 * (1 / 3) ** 3 + 2);
  });
});

describe('readLcov', () => {
  it('asks for a coverage run when the report is missing', async () => {
    await expect(readLcov('/nonexistent', 'coverage/lcov.info')).rejects.toThrow(
      'vp test run --coverage',
    );
  });
});
