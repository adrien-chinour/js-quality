import { describe, expect, it } from 'vite-plus/test';
import { complexityFromMessage, enclosingRange, measureSource } from '../src/complexity.ts';

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
  it('scores the white paper examples like SonarSource', () => {
    expect(measureSource('primes.js', SUM_OF_PRIMES).map((fn) => fn.complexity)).toEqual([7]);
    expect(measureSource('words.js', GET_WORDS).map((fn) => fn.complexity)).toEqual([1]);
  });

  it('gives the line range of the function', () => {
    expect(measureSource('primes.js', SUM_OF_PRIMES)[0]).toMatchObject({
      startLine: 1,
      endLine: 12,
    });
  });

  it('leaves out functions without complexity', () => {
    expect(measureSource('flat.js', 'export const add = (a, b) => a + b;\n')).toEqual([]);
  });

  it('parses TypeScript and JSX', () => {
    const source = `export function View({ items }: { items: string[] }) {
  return items.length > 0 ? <ul>{items.map((item) => <li>{item}</li>)}</ul> : null;
}
`;
    expect(measureSource('view.tsx', source)).toMatchObject([
      { complexity: 1, startLine: 1, endLine: 3 },
    ]);
  });

  it('attributes a nested function to itself, not to its parent', () => {
    const source = `function outer(list) {
  return list.map((item) => {
    if (item) return 1;
    return 0;
  });
}
`;
    expect(measureSource('nested.js', source)).toMatchObject([
      { complexity: 1, startLine: 2, endLine: 5 },
    ]);
  });

  it('fails on a syntax error', () => {
    expect(() => measureSource('broken.js', 'function (')).toThrow('broken.js:1');
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
