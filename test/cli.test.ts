import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { main, parseGates } from '../src/cli.ts';

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
});
