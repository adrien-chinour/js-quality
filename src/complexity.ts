import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseSync } from 'oxc-parser';

const require = createRequire(import.meta.url);
const run = promisify(execFile);

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

export interface SourceFile {
  /** Path relative to the measured root, as reported. */
  file: string;
  source: string;
}

interface AstNode {
  type?: unknown;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);
// `parent` makes the tree cyclic; the others hold no function.
const SKIPPED_KEYS = new Set(['parent', 'range', 'comments']);

// The same rule as SonarQube, so scores match the SonarSource definition of cognitive complexity.
// A limit of 0 makes the rule report every function whose complexity is above 0. Every other
// rule is off; ESLint directives are not honoured, and Oxlint ones are neutralised in the copies.
function oxlintConfig(): object {
  const off = ['correctness', 'suspicious', 'pedantic', 'style', 'perf', 'restriction', 'nursery'];
  return {
    categories: Object.fromEntries(off.map((category) => [category, 'off'])),
    plugins: [],
    // An absolute path: a package name would be resolved from the configuration's directory.
    jsPlugins: [require.resolve('eslint-plugin-sonarjs')],
    rules: { 'sonarjs/cognitive-complexity': ['error', 0] },
    options: { respectEslintDisableDirectives: false },
  };
}

function isNode(value: unknown): value is AstNode {
  return typeof (value as AstNode | null)?.type === 'string';
}

/** Child nodes of a node, arrays of nodes flattened. */
function children(node: AstNode): unknown[] {
  return Object.entries(node)
    .filter(([key, value]) => !SKIPPED_KEYS.has(key) && typeof value === 'object')
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
}

/** Line (1-based) of each UTF-16 offset, which is what oxc-parser reports. */
function lineAt(source: string): (offset: number) => number {
  const starts = [0];
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return (offset) => starts.findLastIndex((start) => start <= offset) + 1;
}

function collectFunctions(
  node: AstNode,
  line: (offset: number) => number,
  found: LineRange[],
): void {
  if (FUNCTION_TYPES.has(node.type as string)) {
    found.push({ startLine: line(node.start as number), endLine: line(node.end as number) });
  }
  for (const child of children(node).filter(isNode)) collectFunctions(child, line, found);
}

type Language = 'ts' | 'tsx' | 'jsx';

// Like the former ESLint setup: JSX allowed in every JavaScript file, and every file a module.
function languageOf(file: string): Language {
  const extension = extname(file);
  if (extension === '.tsx') return 'tsx';
  return ['.ts', '.mts', '.cts'].includes(extension) ? 'ts' : 'jsx';
}

/** Line ranges of every function of a source; fails on a syntax error. */
export function functionRanges({ file, source }: SourceFile): LineRange[] {
  const { program, errors } = parseSync(file, source, {
    lang: languageOf(file),
    sourceType: 'module',
  });
  const line = lineAt(source);
  const [error] = errors;
  if (error) throw new Error(`${file}:${line(error.labels[0]?.start ?? 0)}: ${error.message}`);
  const ranges: LineRange[] = [];
  collectFunctions(program as unknown as AstNode, line, ranges);
  return ranges;
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

// Same length, so lines and columns stay put: `eslint_disable` is no directive.
const DIRECTIVE = /\b(eslint|oxlint)-disable/g;

export function neutraliseDirectives(source: string): string {
  return source.replace(DIRECTIVE, '$1_disable');
}

interface OxlintDiagnostic {
  message: string;
  filename: string;
  labels: { span: { line: number } }[];
}

interface OxlintReport {
  diagnostics: OxlintDiagnostic[];
  number_of_files: number;
}

async function runOxlint(directory: string): Promise<OxlintReport> {
  const bin = join(dirname(require.resolve('oxlint/package.json')), 'bin', 'oxlint');
  const args = [bin, '-c', '.oxlintrc.json', '-f', 'json', '--disable-nested-config', '.'];
  // Exit code 1 only means some function was reported.
  const { stdout } = await run(process.execPath, args, {
    cwd: directory,
    maxBuffer: 256 * 1024 * 1024,
  }).catch((error: Error & { code?: unknown; stdout?: string; stderr?: string }) => {
    if (error.code === 1 && error.stdout) return { stdout: error.stdout };
    throw new Error(`oxlint failed: ${error.stderr || error.message}`);
  });
  return JSON.parse(stdout) as OxlintReport;
}

/**
 * Name of the copy of the source at `index`: flat, so no `../` leads out of the temporary directory
 * and no path matches a pattern Oxlint skips (`*.min.js`…); its extension sets the language.
 */
function copyName(index: number, file: string): string {
  return `${index}.${languageOf(file)}`;
}

/**
 * Copies of the sources, directives neutralised, measured by Oxlint in a temporary directory;
 * diagnostics carry the original path back.
 */
async function lintCopies(sources: SourceFile[]): Promise<OxlintDiagnostic[]> {
  const directory = await mkdtemp(join(tmpdir(), 'jsq-oxlint-'));
  try {
    await writeFile(join(directory, '.oxlintrc.json'), JSON.stringify(oxlintConfig()));
    const original = new Map<string, string>();
    for (const [index, { file, source }] of sources.entries()) {
      original.set(copyName(index, file), file);
      await writeFile(join(directory, copyName(index, file)), neutraliseDirectives(source));
    }
    const report = await runOxlint(directory);
    if (report.number_of_files !== sources.length) {
      throw new Error(`oxlint linted ${report.number_of_files} of ${sources.length} file(s)`);
    }
    return report.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      filename: original.get(diagnostic.filename) ?? diagnostic.filename,
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function toComplexity(
  diagnostic: OxlintDiagnostic,
  ranges: Map<string, LineRange[]>,
): FunctionComplexity {
  const file = diagnostic.filename;
  const line = diagnostic.labels[0]?.span.line ?? 0;
  const complexity = complexityFromMessage(diagnostic.message);
  if (complexity === undefined) throw new Error(`${file}:${line}: ${diagnostic.message}`);
  const range = enclosingRange(ranges.get(file) ?? [], line) ?? { startLine: line, endLine: line };
  return { file, line, complexity, ...range };
}

// Code point order, like the sorted list of source files.
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Cognitive complexity of every function whose complexity is above 0, in file then line order. */
export async function measureSources(sources: SourceFile[]): Promise<FunctionComplexity[]> {
  if (sources.length === 0) return [];
  const ranges = new Map(sources.map((source) => [source.file, functionRanges(source)]));
  const diagnostics = await lintCopies(sources);
  return diagnostics
    .map((diagnostic) => toComplexity(diagnostic, ranges))
    .sort((a, b) => compareText(a.file, b.file) || a.line - b.line);
}

/** Cognitive complexity of every function of one source text whose complexity is above 0. */
export function measureSource(file: string, source: string): Promise<FunctionComplexity[]> {
  return measureSources([{ file, source }]);
}

export async function measureFiles(root: string, files: string[]): Promise<FunctionComplexity[]> {
  const sources = await Promise.all(
    files.map(async (file) => ({ file, source: await readFile(join(root, file), 'utf8') })),
  );
  return measureSources(sources);
}
