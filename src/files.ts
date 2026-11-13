import { glob } from 'tinyglobby';
import type { Config } from './config.ts';

/** Source files measured by the gates, relative to the root and sorted. */
export async function sourceFiles(root: string, config: Config): Promise<string[]> {
  const files = await glob(config.src, { cwd: root, ignore: config.ignore });
  return files.sort();
}
