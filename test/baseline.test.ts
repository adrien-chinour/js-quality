import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import {
  compareToBaseline,
  readBaseline,
  serializeBaseline,
  writeBaseline,
} from '../src/baseline.ts';

describe('serializeBaseline', () => {
  it('orders gates and keys whatever the input order, and drops empty sections', () => {
    const text = serializeBaseline({
      duplication: { 'src/b.ts <> src/c.ts': 1, 'src/a.ts <> src/b.ts': 2 },
      crap: {},
      complexity: { 'src/z.ts:f': 20, 'src/a.ts:g#2': 16 },
    });
    expect(text).toBe(
      `${JSON.stringify(
        {
          complexity: { 'src/a.ts:g#2': 16, 'src/z.ts:f': 20 },
          duplication: { 'src/a.ts <> src/b.ts': 2, 'src/b.ts <> src/c.ts': 1 },
        },
        null,
        2,
      )}\n`,
    );
    expect(serializeBaseline({ crap: { b: 1, a: 2 } })).toBe(
      serializeBaseline({ crap: { a: 2, b: 1 } }),
    );
  });
});

describe('readBaseline and writeBaseline', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'baseline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads nothing when there is no baseline', async () => {
    expect(await readBaseline(join(dir, 'missing.json'))).toBeUndefined();
  });

  it('reads back what it wrote', async () => {
    const path = join(dir, 'jsq-baseline.json');
    await writeBaseline(path, { crap: { 'src/a.ts:f': 12.5 } });
    expect(await readBaseline(path)).toEqual({ crap: { 'src/a.ts:f': 12.5 } });
    expect(await readFile(path, 'utf8')).toBe(serializeBaseline({ crap: { 'src/a.ts:f': 12.5 } }));
  });

  it.each(['[]', 'null', '"crap"'])('rejects %s, which is no object', async (text) => {
    const path = join(dir, 'other.json');
    await writeFile(path, text);
    await expect(readBaseline(path)).rejects.toThrow(`invalid baseline ${path}: not an object`);
  });

  it.each(['5', '[12]', 'null'])('rejects a section %s, which is no object', async (section) => {
    const path = join(dir, 'section.json');
    await writeFile(path, `{ "crap": ${section} }`);
    await expect(readBaseline(path)).rejects.toThrow(
      `invalid baseline ${path}: crap is not an object`,
    );
  });

  it('fails on a baseline it cannot read, other than a missing one', async () => {
    await expect(readBaseline(dir)).rejects.toThrow('EISDIR');
  });

  it('rejects a file that is no baseline, naming it', async () => {
    const path = join(dir, 'broken.json');
    await writeFile(path, '{ "crap": ');
    await expect(readBaseline(path)).rejects.toThrow(`invalid baseline ${path}`);
    await writeFile(path, '{ "speed": {} }');
    await expect(readBaseline(path)).rejects.toThrow(
      `invalid baseline ${path}: unknown gate speed`,
    );
    await writeFile(path, '{ "crap": { "src/a.ts:f": "high" } }');
    await expect(readBaseline(path)).rejects.toThrow(
      `invalid baseline ${path}: crap.src/a.ts:f is not a number`,
    );
  });
});

describe('compareToBaseline', () => {
  it('fails new violations and violations above their frozen value, in their order', () => {
    const current = { worse: 12, same: 10, better: 8, fresh: 30 };
    const frozen = { worse: 11, same: 10, better: 9, gone: 5 };
    expect(compareToBaseline(current, frozen)).toEqual({
      failing: ['worse', 'fresh'],
      stale: ['gone'],
    });
  });

  it('lists frozen entries that no longer violate the gate, sorted', () => {
    expect(compareToBaseline({}, { b: 1, a: 2 })).toEqual({ failing: [], stale: ['a', 'b'] });
  });
});
