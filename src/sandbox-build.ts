// Stryker's build command (see strykerConfig): runs once in its sandbox, before the tests.
import { rewriteSandboxTsconfigs } from './sandbox.ts';

await rewriteSandboxTsconfigs(process.cwd());
