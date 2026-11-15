import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { loadConfig, mergeConfig } from '../src/config.ts';
import { runMutation } from '../src/mutation.ts';

// A package whose tsconfig.json extends a file of the repository root, out of Stryker's sandbox.
const PACKAGE = 'test/fixtures/monorepo/packages/lib';

describe('runMutation', () => {
  it('mutates a monorepo package whose tsconfig extends a root file, with the Vitest runner', async () => {
    const status = await runMutation(PACKAGE, await loadConfig(PACKAGE), []);
    expect(status).toBe(0);
    expect(existsSync(join(PACKAGE, '.stryker-tmp'))).toBe(false);
  }, 120_000);

  it('runs the configured command instead when mutation.command is set', async () => {
    const config = mergeConfig({ mutation: { command: 'vp test run' } });
    expect(await runMutation(PACKAGE, config, [])).toBe(0);
  }, 120_000);
});
