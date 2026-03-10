import * as path from 'path';
import { ILanguage } from './language.interface';

export class TypeScriptLanguage implements ILanguage {
  readonly name = 'typescript';
  readonly extension = '.ts';
  readonly needsCompilation = true;

  getCompileCommand(sourcePath: string, outputPath: string) {
    return {
      cmd: 'tsc',
      args: [
        '--strict', '--target', 'ES2021', '--module', 'commonjs',
        '--outDir', outputPath,
        sourcePath,
      ],
    };
  }

  getRunCommand(_sourcePath: string, outputPath: string) {
    return { cmd: 'node', args: [path.join(outputPath, 'main.js')] };
  }

  getReadonlyMounts(): string[] {
    return ['/usr/local/lib/node_modules'];
  }
}
