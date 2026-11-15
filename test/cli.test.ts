import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { main, parseGates } from '../src/cli.ts';
import { runMutation } from '../src/mutation.ts';

vi.mock('../src/mutation.ts', () => ({ runMutation: vi.fn(async () => 0) }));

const ROOT = 'test/fixtures/project';

describe('parseGates', () => {
  it('selects every gate by default', () => {
    expect(parseGates(undefined)).toEqual(['complexity', 'crap', 'duplication']);
  });

  it('selects the listed gates', () => {
    expect(parseGates('crap, duplication')).toEqual(['crap', 'duplication']);
  });

  it('rejects an unknown gate', () => {
    expect(() => parseGates('crap,speed')).toThrow('unknown gate(s): speed');
  });
});

describe('main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('prints the usage on --help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['--help'], ROOT)).toBe(0);
    expect(log.mock.calls[0][0]).toContain('jsq check');
  });

  it('exits 2 without command or with an unknown one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main([], ROOT)).toBe(2);
    expect(await main(['lint'], ROOT)).toBe(2);
    expect(error.mock.calls.map(([message]) => String(message).split('\n')[0])).toEqual([
      'missing command',
      'unknown command: lint',
    ]);
  });

  it('exits 1 when a gate fails and 0 when all pass', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['check', '--only', 'duplication'], ROOT)).toBe(1);
    expect(log.mock.calls[0][0]).toContain('✗ duplication');
    expect(await main(['check', '--only', 'complexity'], ROOT)).toBe(0);
  });

  it('passes the same files to the mutation gate with or without -- after the command', async () => {
    expect(await main(['mutation', '--', '--mutate', 'src/a.ts'], ROOT)).toBe(0);
    expect(await main(['mutation', '--mutate', 'src/a.ts'], ROOT)).toBe(0);
    expect(vi.mocked(runMutation).mock.calls.map(([, , only]) => only)).toEqual([
      ['src/a.ts'],
      ['src/a.ts'],
    ]);
  });

  it('selects the same gates with or without -- after the command', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['check', '--', '--only', 'complexity'], ROOT)).toBe(0);
    expect(await main(['check', '--only', 'complexity'], ROOT)).toBe(0);
    const [withDashes, without] = log.mock.calls.map(([message]) => String(message));
    expect(withDashes).toBe(without);
    expect(withDashes).toMatch(/^✓ complexity /);
    expect(withDashes).not.toContain('crap');
  });

  it('exits 2 on an extra positional argument without running any gate', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['check', 'extra'], ROOT)).toBe(2);
    expect(await main(['mutation', 'src/a.ts'], ROOT)).toBe(2);
    const messages = error.mock.calls.map(([message]) => String(message));
    expect(messages.map((message) => message.split('\n')[0])).toEqual([
      'unexpected argument: extra',
      'unexpected argument: src/a.ts',
    ]);
    expect(messages.every((message) => message.includes('Usage:'))).toBe(true);
    expect(log).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe('main with a baseline', () => {
  let root: string;
  const output = () =>
    vi
      .mocked(console.log)
      .mock.calls.map(([message]) => String(message))
      .join('\n');
  const configure = (jsq: object) =>
    writeFile(join(root, 'package.json'), JSON.stringify({ jsq: { lcov: 'lcov.info', ...jsq } }));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cli-baseline-'));
    await cp(ROOT, root, { recursive: true });
    await configure({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('freezes the current violations in a stable file, then passes', async () => {
    expect(await main(['check'], root)).toBe(1);
    expect(await main(['check', '--write-baseline'], root)).toBe(0);
    const written = await readFile(join(root, 'jsq-baseline.json'), 'utf8');
    expect(JSON.parse(written)).toEqual({
      crap: { 'src/complex.ts:classify': 156 },
      duplication: { 'src/dup-a.ts <> src/dup-b.ts': 1 },
    });
    expect(output()).toContain('crap        1 entry(ies) frozen in jsq-baseline.json');
    expect(await main(['check', '--write-baseline'], root)).toBe(0);
    expect(await readFile(join(root, 'jsq-baseline.json'), 'utf8')).toBe(written);
    expect(await main(['check'], root)).toBe(0);
  });

  it('keeps a function frozen when lines are added above it', async () => {
    await main(['check', '--write-baseline', '--only', 'crap'], root);
    const file = join(root, 'src/complex.ts');
    await writeFile(file, `// moved down\n\n${await readFile(file, 'utf8')}`);
    expect(await main(['check', '--only', 'crap'], root)).toBe(0);
  });

  it('fails on a new violation, naming its key and line', async () => {
    await main(['check', '--write-baseline'], root);
    const source = await readFile(join(root, 'src/complex.ts'), 'utf8');
    await writeFile(join(root, 'src/fresh.ts'), `\n${source.replace('classify', 'sort')}`);
    expect(await main(['check', '--only', 'crap'], root)).toBe(1);
    expect(output()).toContain('src/fresh.ts:2  src/fresh.ts:sort: not frozen');
  });

  it('warns about a frozen entry that no longer fails, and still passes', async () => {
    await writeFile(
      join(root, 'jsq-baseline.json'),
      JSON.stringify({ crap: { 'src/complex.ts:classify': 156, 'src/gone.ts:f': 20 } }),
    );
    expect(await main(['check', '--only', 'crap'], root)).toBe(0);
    expect(output()).toContain('! 1 frozen entry(ies) no longer fail');
    expect(output()).toContain('src/gone.ts:f');
  });

  it('rewrites only the gates selected by --only, at the path of the jsq block', async () => {
    await configure({ baseline: 'quality/frozen.json' });
    await main(['check', '--write-baseline', '--only', 'crap'], root);
    await main(['check', '--write-baseline', '--only', 'duplication'], root);
    const frozen = JSON.parse(await readFile(join(root, 'quality/frozen.json'), 'utf8'));
    expect(Object.keys(frozen)).toEqual(['crap', 'duplication']);
    expect(await main(['check'], root)).toBe(0);
  });
});
