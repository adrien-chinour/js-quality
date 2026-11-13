import { describe, expect, it } from 'vite-plus/test';
import { detectClones, exceeds, toReport } from '../src/duplication.ts';

const ROOT = 'test/fixtures/project';
const SETTINGS = { minTokens: 40, minLines: 4, threshold: 0 };

describe('detectClones', () => {
  it('finds a copied function, with paths relative to the root', async () => {
    const report = await detectClones(
      ROOT,
      ['src/dup-a.ts', 'src/dup-b.ts', 'src/clean.ts'],
      SETTINGS,
    );
    expect(report.clones).toHaveLength(1);
    expect(report.clones[0]).toMatchObject({
      first: { name: 'src/dup-a.ts' },
      second: { name: 'src/dup-b.ts' },
    });
    expect(report.percentage).toBeGreaterThan(0);
  });

  it('finds nothing in distinct files', async () => {
    const report = await detectClones(ROOT, ['src/clean.ts', 'src/complex.ts'], SETTINGS);
    expect(report).toEqual({ clones: [], percentage: 0 });
  });

  it('ignores clones shorter than the minimum', async () => {
    const report = await detectClones(ROOT, ['src/dup-a.ts', 'src/dup-b.ts'], {
      ...SETTINGS,
      minLines: 20,
    });
    expect(report.clones).toEqual([]);
  });

  it('skips the run without files', async () => {
    expect(await detectClones(ROOT, [], SETTINGS)).toEqual({ clones: [], percentage: 0 });
  });
});

describe('toReport', () => {
  it('keeps the location of both copies', () => {
    const location = (name: string) => ({ name, start: 1, end: 4 });
    const report = toReport(
      {
        duplicates: [
          { firstFile: location('/r/a.ts'), secondFile: location('/r/b.ts'), lines: 4, tokens: 50 },
        ],
        statistics: { total: { percentage: 12.5 } },
      },
      '/r',
    );
    expect(report).toEqual({
      clones: [{ first: location('a.ts'), second: location('b.ts'), lines: 4, tokens: 50 }],
      percentage: 12.5,
    });
  });
});

describe('exceeds', () => {
  it('fails strictly above the threshold, so 0 forbids any clone', () => {
    expect(exceeds({ clones: [], percentage: 0 }, 0)).toBe(false);
    expect(exceeds({ clones: [], percentage: 0.1 }, 0)).toBe(true);
    expect(exceeds({ clones: [], percentage: 3 }, 3)).toBe(false);
  });
});
