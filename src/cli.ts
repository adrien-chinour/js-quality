#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readBaseline, writeBaseline } from './baseline.ts';
import { formatResults, GATES, runCheck, type Gate } from './check.ts';
import { loadConfig, type Config } from './config.ts';
import { runMutation } from './mutation.ts';

const USAGE = `Usage:
  jsq check [--only complexity,crap,duplication]   cognitive complexity, CRAP and duplication gates
  jsq check --write-baseline [--only …]            freeze the current violations of the gates
  jsq mutation [--mutate <glob>]...                 mutation testing with Stryker

Settings: optional "jsq" block of package.json (src, ignore, complexity, crap, lcov, baseline,
duplication.{minTokens,minLines,threshold}, mutation.{command,break,mutate}).`;

export function parseGates(value: string | undefined): Gate[] {
  if (value === undefined) return [...GATES];
  const names = value.split(',').map((name) => name.trim());
  const unknown = names.filter((name) => !(GATES as readonly string[]).includes(name));
  if (unknown.length > 0) throw new Error(`unknown gate(s): ${unknown.join(', ')}`);
  return names as Gate[];
}

/** Rewrites the sections of the selected gates with their current violations; the other sections stay. */
async function freeze(root: string, config: Config, gates: Gate[]): Promise<number> {
  const path = resolve(root, config.baseline);
  const results = await runCheck(root, config, gates);
  const fresh = Object.fromEntries(results.map((result) => [result.gate, result.violations]));
  await writeBaseline(path, { ...(await readBaseline(path)), ...fresh });
  for (const { gate, violations } of results) {
    const count = Object.keys(violations).length;
    console.log(`${gate.padEnd(11)} ${count} entry(ies) frozen in ${config.baseline}`);
  }
  return 0;
}

async function check(
  root: string,
  only: string | undefined,
  writing: boolean | undefined,
): Promise<number> {
  const config = await loadConfig(root);
  const gates = parseGates(only);
  if (writing) return freeze(root, config, gates);
  const baseline = await readBaseline(resolve(root, config.baseline));
  const results = await runCheck(root, config, gates, baseline);
  console.log(formatResults(results));
  return results.every((result) => result.passed) ? 0 : 1;
}

/** `vp run <script> -- <options>` forwards the `--` as is: one right after the command only separates its options. */
function withoutSeparator(argv: string[]): string[] {
  return argv[1] === '--' ? [argv[0], ...argv.slice(2)] : argv;
}

function parseCommand(argv: string[]) {
  return parseArgs({
    args: withoutSeparator(argv),
    allowPositionals: true,
    options: {
      only: { type: 'string' },
      'write-baseline': { type: 'boolean' },
      mutate: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
}

function misuse(message: string): number {
  console.error(`${message}\n\n${USAGE}`);
  return 2;
}

/** Runs a command in the project at `root` and returns the exit code: 0 passed, 1 a gate failed, 2 misuse. */
export async function main(argv: string[], root = process.cwd()): Promise<number> {
  const { positionals, values } = parseCommand(argv);
  const [command, extra] = positionals;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (extra !== undefined) return misuse(`unexpected argument: ${extra}`);
  if (command === 'check') return check(root, values.only, values['write-baseline']);
  if (command === 'mutation') {
    return runMutation(root, await loadConfig(root), values.mutate ?? []);
  }
  return misuse(command ? `unknown command: ${command}` : 'missing command');
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`jsq: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
