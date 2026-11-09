import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface FunctionComplexity extends LineRange {
  file: string;
  /** Line SonarJS reports the function at (its name or its first token). */
  line: number;
  complexity: number;
}

interface AstNode {
  type?: unknown;
  loc?: { start: { line: number }; end: { line: number } };
  [key: string]: unknown;
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
// `parent` makes the tree cyclic; the others hold no function.
const SKIPPED_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

// The same rule as SonarQube, so scores match the SonarSource definition of cognitive complexity.
// A limit of 0 makes the rule report every function whose complexity is above 0.
const lintConfig: Linter.Config[] = [
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { sonarjs: sonarjs as never },
    rules: { 'sonarjs/cognitive-complexity': ['error', 0] },
  },
];

function isNode(value: unknown): value is AstNode {
  return typeof (value as AstNode | null)?.type === 'string';
}

/** Child nodes of a node, arrays of nodes flattened. */
function children(node: AstNode): unknown[] {
  return Object.entries(node)
    .filter(([key, value]) => !SKIPPED_KEYS.has(key) && typeof value === 'object')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
}

function functionRange(node: AstNode): LineRange | undefined {
  if (!FUNCTION_TYPES.has(node.type as string) || !node.loc) return undefined;
  return { startLine: node.loc.start.line, endLine: node.loc.end.line };
}

function collectFunctions(node: AstNode, found: LineRange[]): void {
  const range = functionRange(node);
  if (range) found.push(range);
  for (const child of children(node).filter(isNode)) collectFunctions(child, found);
}

/** The innermost range holding a line. */
export function enclosingRange(ranges: LineRange[], line: number): LineRange | undefined {
  const holding = ranges.filter((range) => range.startLine <= line && line <= range.endLine);
  return holding.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0];
}

export function complexityFromMessage(message: string): number | undefined {
  const match = /Cognitive Complexity from (\d+)/.exec(message);
  return match ? Number(match[1]) : undefined;
}

/** Cognitive complexity of every function of one source text whose complexity is above 0. */
export function measureSource(file: string, source: string): FunctionComplexity[] {
  const linter = new Linter();
  const messages = linter.verify(source, lintConfig, { filename: file });
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file}:${fatal.line}: ${fatal.message}`);
  const sourceCode = linter.getSourceCode();
  if (!sourceCode) throw new Error(`${file}: not a JavaScript or TypeScript file`);
  const ranges: LineRange[] = [];
  collectFunctions(sourceCode.ast as unknown as AstNode, ranges);
  return messages.map(({ message, line }) => {
    const complexity = complexityFromMessage(message);
    if (complexity === undefined) throw new Error(`${file}:${line}: ${message}`);
    const range = enclosingRange(ranges, line) ?? { startLine: line, endLine: line };
    return { file, line, complexity, ...range };
  });
}

export async function measureFiles(root: string, files: string[]): Promise<FunctionComplexity[]> {
  const measures = await Promise.all(
    files.map(async (file) => measureSource(file, await readFile(join(root, file), 'utf8'))),
  );
  return measures.flat();
}
