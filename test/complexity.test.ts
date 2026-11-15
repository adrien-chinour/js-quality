import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import {
  complexityFromMessage,
  enclosingFunction,
  functionRanges,
  measureFiles,
  measureSource,
  neutraliseDirectives,
  utf16Offset,
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

  it('gives the name and line range of the function', async () => {
    expect((await measureSource('primes.js', SUM_OF_PRIMES))[0]).toMatchObject({
      name: 'sumOfPrimes',
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

  it.each(['view.js', 'view.mjs', 'view.cjs'])('parses JSX in %s', async (file) => {
    const source = 'export const View = ({ on }) => (on ? <b>on</b> : null);\n';
    expect(await measureSource(file, source)).toMatchObject([
      { complexity: 1, startLine: 1, endLine: 1 },
    ]);
  });

  it('measures files Oxlint would skip by their path, like minified ones', async () => {
    const source = 'export function f(x) {\n  return x ? 1 : 0;\n}\n';
    expect(await measureSource('dist/lib.min.js', source)).toMatchObject([
      { file: 'dist/lib.min.js', line: 1, complexity: 1 },
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

  it('tells apart a function and its callback that start on the same line', async () => {
    const source = `const s = 'é😀'; export const outer = (xs: number[]) => xs.map((x) => {
  if (x > 1) { if (x > 2) { return 1; } } return 0; })
  .length > 2 ? 1 : 0;
`;
    const measured = await measureSource('same-line.ts', source);
    expect(measured.map(({ name, startLine, endLine }) => ({ name, startLine, endLine }))).toEqual(
      expect.arrayContaining([
        { name: 'outer', startLine: 1, endLine: 3 },
        { name: 'map(callback)', startLine: 1, endLine: 2 },
      ]),
    );
    expect(measured).toHaveLength(2);
  });

  it('attributes a method to itself when SonarJS reports it at its name', async () => {
    const source = `const handler = { run(x) { if (x) return 1; return 0; } };
class Service {
  get value() { return this.a ? 1 : 0; }
  async load(x) { if (x) { return x; } return null; }
  static make(x) { return x ? new Service() : null; }
}
`;
    expect((await measureSource('methods.js', source)).map((fn) => fn.name)).toEqual([
      'run',
      'value',
      'load',
      'make',
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

  it('measures a file outside the root without writing outside its temporary directory', async () => {
    const base = await mkdtemp(join(tmpdir(), 'complexity-base-'));
    try {
      const outside = `jsq-outside-${process.pid}`;
      await mkdir(join(base, 'project'));
      await mkdir(join(base, outside));
      await writeFile(
        join(base, outside, 'x.ts'),
        'export function f(x) {\n  return x ? 1 : 0;\n}\n',
      );
      const before = await tempEntries();
      expect(await measureFiles(join(base, 'project'), [`../${outside}/x.ts`])).toMatchObject([
        { file: `../${outside}/x.ts`, line: 1, complexity: 1, startLine: 1, endLine: 3 },
      ]);
      expect(await tempEntries()).toEqual(before);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('measures nothing when there is no file', async () => {
    expect(await measureFiles('.', [])).toEqual([]);
  });
});

describe('neutraliseDirectives', () => {
  it('breaks ESLint and Oxlint directives without moving any character', () => {
    const source = '/* oxlint-disable */\n// eslint-disable-next-line no-console\nconst a = 1;\n';
    const neutralised = neutraliseDirectives(source);
    expect(neutralised).toBe(
      '/* oxlint_disable */\n// eslint_disable-next-line no-console\nconst a = 1;\n',
    );
    expect(neutralised).toHaveLength(source.length);
  });
});

describe('functionRanges', () => {
  const names = (source: string, file = 'a.ts') =>
    functionRanges({ file, source }).map((range) => range.name);

  it('names a function by its identifier, or by the variable, property or method holding it', () => {
    const source = `export function declared() {}
export default function () {}
const assigned = () => 1;
const expression = function inner() {};
let typed: () => number = (): number => 1;
module.exports.exported = () => 2;
const object = { property: () => 3, method() {}, 'quoted': function () {}, [computed]: () => 4 };
class Service {
  constructor() {}
  get value() { return 1; }
  field = () => 5;
  #secret() {}
}
`;
    expect(names(source)).toEqual([
      'declared',
      'default',
      'assigned',
      'inner',
      'typed',
      'exported',
      'property',
      'method',
      'quoted',
      '<anonymous>',
      'constructor',
      'value',
      'field',
      'secret',
    ]);
  });

  it('names a function passed as an argument after its callee', () => {
    const source = `items.forEach((item) => item);
transaction(async () => {});
new Promise((resolve) => resolve(1));
const wrapped = memo((props) => props);
(() => {})();
`;
    expect(names(source)).toEqual([
      'forEach(callback)',
      'transaction(callback)',
      'Promise(callback)',
      'memo(callback)',
      '<anonymous>',
    ]);
  });

  it('looks through parentheses and type assertions', () => {
    const source = `const parenthesised = (() => 1);
const asserted = (() => 2) as () => number;
`;
    expect(names(source)).toEqual(['parenthesised', 'asserted']);
    const more = `const satisfying = (() => 3) satisfies () => number;
const nonNull = (() => 4)!;
const cast = <() => number>(() => 5);
`;
    expect(names(more)).toEqual(['satisfying', 'nonNull', 'cast']);
  });

  it('names a callback of a call whose callee has no name anonymous', () => {
    expect(names('factory()(() => 1);\nlist[0](() => 2);\n')).toEqual([
      '<anonymous>',
      '<anonymous>#2',
    ]);
  });

  it('numbers homonyms of a file in source order', () => {
    const source = 'list.map(() => 1);\nfunction f() {}\nlist.map(() => 2);\nlist.map(() => 3);\n';
    expect(names(source)).toEqual(['map(callback)', 'f', 'map(callback)#2', 'map(callback)#3']);
  });

  it('keeps the name of a function when lines are added above it', () => {
    const source = 'function f() {}\nlist.map(() => 1);\n';
    const shifted = `// a comment\n\nconst x = 1;\n${source}`;
    expect(names(shifted)).toEqual(names(source));
  });
});

describe('enclosingFunction', () => {
  it('returns the innermost function holding an offset, its end excluded', () => {
    const outer = { name: 'outer', from: 0, to: 100, startLine: 1, endLine: 10 };
    const inner = { name: 'inner', from: 20, to: 40, startLine: 1, endLine: 5 };
    expect(enclosingFunction([outer, inner], 30)).toBe(inner);
    expect(enclosingFunction([outer, inner], 40)).toBe(outer);
    expect(enclosingFunction([outer, inner], 0)).toBe(outer);
    expect(enclosingFunction([outer, inner], 100)).toBeUndefined();
  });
});

describe('utf16Offset', () => {
  it('converts a UTF-8 byte offset to a UTF-16 one', () => {
    const source = "'é😀' + x";
    const bytes = Buffer.from(source, 'utf8');
    expect(utf16Offset(bytes, Buffer.byteLength("'é😀' + "))).toBe(source.indexOf('x'));
    expect(utf16Offset(bytes, 0)).toBe(0);
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
