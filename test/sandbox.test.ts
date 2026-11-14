import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { parseJsonc, rewriteSandboxTsconfigs, rewriteTsconfig } from '../src/sandbox.ts';

describe('parseJsonc', () => {
  it('reads JSON with comments and trailing commas, leaving strings untouched', () => {
    const text = `{
      // line comment
      "a": "http://x/*y*/", /* block
      comment */
      "b": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({ a: 'http://x/*y*/', b: [1, 2] });
  });

  it('keeps escaped quotes inside strings', () => {
    expect(parseJsonc('{ "a": "say \\"//hi\\"," }')).toEqual({ a: 'say "//hi",' });
  });
});

describe('rewriteTsconfig', () => {
  it('climbs two more levels for the paths that leave the sandbox', () => {
    const config = {
      extends: '../../tsconfig.base.json',
      references: [{ path: '../model' }, { path: './local' }],
      include: ['src', '../shared/src'],
      exclude: ['../other'],
      files: ['../../types.d.ts'],
    };
    expect(rewriteTsconfig(config, 'tsconfig.json')).toEqual({
      extends: '../../../../tsconfig.base.json',
      references: [{ path: '../../../model' }, { path: './local' }],
      include: ['src', '../../../shared/src'],
      exclude: ['../../../other'],
      files: ['../../../../types.d.ts'],
    });
  });

  it('measures the way out from the tsconfig file own directory', () => {
    expect(rewriteTsconfig({ extends: '../base.json' }, 'apps/web/tsconfig.json')).toBeUndefined();
    expect(rewriteTsconfig({ extends: '../../../base.json' }, 'apps/web/tsconfig.json')).toEqual({
      extends: '../../../../../base.json',
    });
  });

  it('handles several extends and leaves package names alone', () => {
    const config = { extends: ['@tsconfig/node24/tsconfig.json', '../../base.json'] };
    expect(rewriteTsconfig(config, 'tsconfig.json')).toEqual({
      extends: ['@tsconfig/node24/tsconfig.json', '../../../../base.json'],
    });
  });

  it('returns undefined when no path leaves the sandbox', () => {
    const config = {
      extends: './tsconfig.base.json',
      include: ['src'],
      references: [{ path: 'a' }],
    };
    expect(rewriteTsconfig(config, 'tsconfig.json')).toBeUndefined();
    expect(rewriteTsconfig({ compilerOptions: { strict: true } }, 'tsconfig.json')).toBeUndefined();
  });
});

describe('rewriteSandboxTsconfigs', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'jsq-sandbox-'));
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('rewrites the tsconfig files that point out of the sandbox, and only those', async () => {
    await mkdir(join(sandbox, 'web'));
    await mkdir(join(sandbox, 'node_modules', 'pkg'), { recursive: true });
    const dependency = '{ "extends": "../../../base.json" }';
    await writeFile(join(sandbox, 'node_modules', 'pkg', 'tsconfig.json'), dependency);
    const local = '{ "extends": "./tsconfig.base.json" } // kept as is\n';
    await writeFile(join(sandbox, 'tsconfig.json'), '{ "extends": "../../base.json", }');
    await writeFile(
      join(sandbox, 'web', 'tsconfig.app.json'),
      '{ "extends": "../../../base.json" }',
    );
    await writeFile(join(sandbox, 'tsconfig.local.json'), local);

    await rewriteSandboxTsconfigs(sandbox);

    const read = async (file: string) => readFile(join(sandbox, file), 'utf8');
    expect(JSON.parse(await read('tsconfig.json'))).toEqual({ extends: '../../../../base.json' });
    expect(JSON.parse(await read('web/tsconfig.app.json'))).toEqual({
      extends: '../../../../../base.json',
    });
    expect(await read('tsconfig.local.json')).toBe(local);
    expect(await read('node_modules/pkg/tsconfig.json')).toBe(dependency);
  });
});
