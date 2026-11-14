import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import {
  complexityFromMessage,
  enclosingRange,
  measureFiles,
  measureSource,
} from '../src/complexity.ts';

// Examples of the SonarSource white paper "Cognitive Complexity" (G. Ann Campbell).
const SUM_OF_PRIMES = `function sumOfPrimes(max) {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) {
    for (let j = 2; j < i; ++j) {
      if (i % j == 0) {
        continue OUT;
      }
    }
    total += i;
  }
  return total;
}
`;

const GET_WORDS = `function getWords(number) {
  switch (number) {
    case 1:
      return "one";
    case 2:
      return "a couple";
    default:
      return "lots";
  }
}
`;

describe('measureSource', () => {
  it('scores the white paper examples like SonarSource', async () => {
    expect((await measureSource('primes.js', SUM_OF_PRIMES)).map((fn) => fn.complexity)).toEqual([
      7,
    ]);
    expect((await measureSource('words.js', GET_WORDS)).map((fn) => fn.complexity)).toEqual([1]);
  });

  it('gives the line range of the function', async () => {
    expect((await measureSource('primes.js', SUM_OF_PRIMES))[0]).toMatchObject({
      startLine: 1,
      endLine: 12,
    });
  });

  it('leaves out functions without complexity', async () => {
    expect(await measureSource('flat.js', 'export const add = (a, b) => a + b;\n')).toEqual([]);
  });

  it('parses TypeScript and JSX', async () => {
    const source = `export function View({ items }: { items: string[] }) {
  return items.length > 0 ? <ul>{items.map((item) => <li>{item}</li>)}</ul> : null;
}
`;
    expect(await measureSource('view.tsx', source)).toMatchObject([
      { complexity: 1, startLine: 1, endLine: 3 },
    ]);
  });

  it('attributes a nested function to itself, not to its parent', async () => {
    const source = `function outer(list) {
  return list.map((item) => {
    if (item) return 1;
    return 0;
  });
}
`;
    expect(await measureSource('nested.js', source)).toMatchObject([
      { complexity: 1, startLine: 2, endLine: 5 },
    ]);
  });

  it('fails on a syntax error', async () => {
    await expect(measureSource('broken.js', 'function (')).rejects.toThrow('broken.js:1');
  });

  it('measures a generated file that disables ESLint, like routeTree.gen.ts', async () => {
    const source = `/* eslint-disable */

// @ts-nocheck

export function pick(route) {
  if (route) return route;
  return null;
}
`;
    expect(await measureSource('src/routeTree.gen.ts', source)).toMatchObject([
      { line: 5, complexity: 1, startLine: 5, endLine: 8 },
    ]);
  });

  it('measures a file whose ESLint directive disables nothing', async () => {
    const source = '/* eslint-disable */\nexport const routeTree = { path: "/" };\n';
    expect(await measureSource('src/routeTree.gen.ts', source)).toEqual([]);
  });

  it.each([
    [
      'an ESLint directive naming the rule',
      '// eslint-disable-next-line sonarjs/cognitive-complexity',
    ],
    ['a bare Oxlint directive', '// oxlint-disable-next-line'],
    ['a file-wide Oxlint directive', '/* oxlint-disable */'],
    [
      'a file-wide ESLint directive naming the rule',
      '/* eslint-disable sonarjs/cognitive-complexity */',
    ],
  ])('ignores %s', async (_, directive) => {
    const source = `${directive}\nfunction hidden(x) {\n  if (x) return 1;\n  return 0;\n}\n`;
    expect(await measureSource('hidden.js', source)).toMatchObject([
      { line: 2, complexity: 1, startLine: 2, endLine: 5 },
    ]);
  });

  it('counts lines right after non-ASCII text', async () => {
    const source = `// Données : « éèà » 🚀 中文
const label = 'Ça marche ✓';
function after(x) {
  if (x) return label;
  return '';
}
`;
    expect(await measureSource('accents.js', source)).toMatchObject([
      { line: 3, complexity: 1, startLine: 3, endLine: 6 },
    ]);
  });
});

describe('measureFiles', () => {
  async function tempEntries(): Promise<string[]> {
    return (await readdir(tmpdir())).filter((name) => name.startsWith('jsq-'));
  }

  it('measures files without changing them nor leaving temporary files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'complexity-project-'));
    try {
      const source =
        '// oxlint-disable-next-line\nexport function f(x) {\n  return x ? 1 : 0;\n}\n';
      await mkdir(join(root, 'src/deep'), { recursive: true });
      await writeFile(join(root, 'src/deep/a.ts'), source);
      await writeFile(join(root, 'src/broken.ts'), 'export function (');
      const before = await tempEntries();
      expect(await measureFiles(root, ['src/deep/a.ts'])).toMatchObject([
        { file: 'src/deep/a.ts', line: 2, complexity: 1, startLine: 2, endLine: 4 },
      ]);
      await expect(measureFiles(root, ['src/deep/a.ts', 'src/broken.ts'])).rejects.toThrow(
        'src/broken.ts:1',
      );
      expect(await tempEntries()).toEqual(before);
      expect(await readFile(join(root, 'src/deep/a.ts'), 'utf8')).toBe(source);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('measures nothing when there is no file', async () => {
    expect(await measureFiles('.', [])).toEqual([]);
  });
});

describe('enclosingRange', () => {
  it('returns the innermost range', () => {
    const ranges = [
      { startLine: 1, endLine: 10 },
      { startLine: 3, endLine: 5 },
    ];
    expect(enclosingRange(ranges, 4)).toEqual({ startLine: 3, endLine: 5 });
    expect(enclosingRange(ranges, 11)).toBeUndefined();
  });
});

describe('complexityFromMessage', () => {
  it('reads the complexity of a SonarJS message', () => {
    expect(complexityFromMessage('reduce its Cognitive Complexity from 12 to the 0 allowed.')).toBe(
      12,
    );
    expect(complexityFromMessage('something else')).toBeUndefined();
  });
});
