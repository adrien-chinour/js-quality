import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
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
