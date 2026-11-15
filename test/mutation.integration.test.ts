import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { loadConfig } from '../src/config.ts';
import { runMutation } from '../src/mutation.ts';

// A package whose tsconfig.json extends a file of the repository root, out of Stryker's sandbox.
const PACKAGE = 'test/fixtures/monorepo/packages/lib';

it('mutates a monorepo package whose tsconfig extends a root file', async () => {
  const status = await runMutation(PACKAGE, await loadConfig(PACKAGE), []);
  expect(status).toBe(0);
  expect(existsSync(join(PACKAGE, '.stryker-tmp'))).toBe(false);
}, 120_000);
