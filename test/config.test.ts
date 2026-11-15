import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { defaults, loadConfig, mergeConfig } from '../src/config.ts';

describe('mergeConfig', () => {
  it('keeps the defaults it does not override, nested ones included', () => {
    const config = mergeConfig({ crap: 8, duplication: { threshold: 2 } });
    expect(config.crap).toBe(8);
    expect(config.complexity).toBe(defaults.complexity);
    expect(config.duplication).toEqual({ ...defaults.duplication, threshold: 2 });
    expect(config.mutation).toEqual(defaults.mutation);
  });
});

describe('loadConfig', () => {
  it('reads the jsq block of package.json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jsq-config-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ jsq: { complexity: 10 } }));
    expect((await loadConfig(root)).complexity).toBe(10);
  });

  it('falls back to the defaults without package.json', async () => {
    expect(await loadConfig(join(tmpdir(), 'jsq-missing'))).toEqual(defaults);
  });
});

describe('defaults', () => {
  it('reads the baseline from jsq-baseline.json at the project root', () => {
    expect(defaults.baseline).toBe('jsq-baseline.json');
  });
});
