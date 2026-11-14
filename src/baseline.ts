import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GATES, type Gate } from './gates.ts';

/** Frozen value of each violation of a gate, by key (`file:name`, or `a.ts <> b.ts` for a clone pair). */
export type Section = Record<string, number>;
export type Baseline = Partial<Record<Gate, Section>>;

function isObject(data: unknown): data is object {
  return typeof data === 'object' && data !== null && !Array.isArray(data);
}

function validateSection(gate: string, section: unknown): void {
  if (!(GATES as readonly string[]).includes(gate)) throw new Error(`unknown gate ${gate}`);
  if (!isObject(section)) throw new Error(`${gate} is not an object`);
  for (const [key, value] of Object.entries(section)) {
    if (typeof value !== 'number') throw new Error(`${gate}.${key} is not a number`);
  }
}

function validate(data: unknown): Baseline {
  if (!isObject(data)) throw new Error('not an object');
  for (const [gate, section] of Object.entries(data)) validateSection(gate, section);
  return data as Baseline;
}

/** The baseline at `path`, or undefined when there is none. */
export async function readBaseline(path: string): Promise<Baseline | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return validate(JSON.parse(text));
  } catch (error) {
    throw new Error(`invalid baseline ${path}: ${(error as Error).message}`, { cause: error });
  }
}

/** Gates in their usual order, keys sorted, empty sections left out: the same text for the same content. */
export function serializeBaseline(baseline: Baseline): string {
  const sections = GATES.flatMap((gate) => {
    const section = baseline[gate] ?? {};
    const keys = Object.keys(section).sort();
    return keys.length === 0
      ? []
      : [[gate, Object.fromEntries(keys.map((key) => [key, section[key]]))]];
  });
  return `${JSON.stringify(Object.fromEntries(sections), null, 2)}\n`;
}

export async function writeBaseline(path: string, baseline: Baseline): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeBaseline(baseline));
}

/**
 * Keys of the current violations that fail (not frozen, or above their frozen value), and frozen keys that no
 * longer violate the gate (fixed or renamed).
 */
export function compareToBaseline(
  current: Section,
  frozen: Section,
): { failing: string[]; stale: string[] } {
  const failing = Object.keys(current).filter(
    (key) => frozen[key] === undefined || current[key] > frozen[key],
  );
  const stale = Object.keys(frozen)
    .filter((key) => current[key] === undefined)
    .sort();
  return { failing, stale };
}
