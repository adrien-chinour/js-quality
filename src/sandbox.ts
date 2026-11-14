import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { glob } from 'tinyglobby';

type Tsconfig = Record<string, unknown> & { references?: { path?: unknown }[] };

const STRING_OR_COMMENT = /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const STRING_OR_TRAILING_COMMA = /("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g;

/** Parses a tsconfig file: JSON with comments and trailing commas, without TypeScript's API. */
export function parseJsonc(text: string): unknown {
  const json = text
    .replace(STRING_OR_COMMENT, (_, string?: string) => string ?? '')
    .replace(
      STRING_OR_TRAILING_COMMA,
      (_, string: string | undefined, closing: string) => string ?? closing,
    );
  return JSON.parse(json);
}

/** Whether a path written in the sandbox file `file` resolves out of the sandbox. */
function leavesSandbox(file: string, reference: string): boolean {
  const path = posix.join(posix.dirname(file), reference);
  return path === '..' || path.startsWith('../');
}

/**
 * Rewrites the paths of a tsconfig file copied into Stryker's sandbox, `<root>/.stryker-tmp/sandbox-…`, that point
 * out of it (`"extends": "../../tsconfig.base.json"` in a monorepo package): two levels more reach the original
 * target. Same rewrite as Stryker's own, which needs TypeScript's API. `file` is relative to the sandbox. Returns
 * undefined when nothing changes.
 */
export function rewriteTsconfig(config: Tsconfig, file: string): Tsconfig | undefined {
  const rewrite = (reference: unknown) =>
    typeof reference === 'string' && leavesSandbox(file, reference)
      ? `../../${reference}`
      : reference;
  const rewritten: Tsconfig = { ...config };
  for (const key of ['extends', 'include', 'exclude', 'files']) {
    const value = config[key];
    if (value !== undefined)
      rewritten[key] = Array.isArray(value) ? value.map(rewrite) : rewrite(value);
  }
  if (Array.isArray(config.references)) {
    rewritten.references = config.references.map((reference) => ({
      ...reference,
      path: rewrite(reference.path),
    }));
  }
  return isDeepStrictEqual(rewritten, config) ? undefined : rewritten;
}

/** Rewrites, in place, the tsconfig files of the sandbox whose paths point out of it. */
export async function rewriteSandboxTsconfigs(sandbox: string): Promise<void> {
  const files = await glob('**/tsconfig*.json', { cwd: sandbox, ignore: ['**/node_modules/**'] });
  await Promise.all(
    files.map(async (file) => {
      const path = join(sandbox, file);
      const config = rewriteTsconfig(parseJsonc(await readFile(path, 'utf8')) as Tsconfig, file);
      if (config) await writeFile(path, JSON.stringify(config, null, 2));
    }),
  );
}
