import * as path from 'path';
import { ILanguage } from './language.interface';

/**
 * TypeScript (Node.js) 语言配置
 */
export class TypeScriptLanguage implements ILanguage {
  readonly name = 'typescript';
  readonly extension = '.ts';
  readonly needsCompilation = true;

  getCompileCommand(sourcePath: string, outputPath: string): { cmd: string; args: string[] } {
    // tsc 输出到 outputPath 目录，编译后文件为 outputPath/main.js
    return {
      cmd: 'tsc',
      args: [
        '--strict',
        '--target',
        'ES2021',
        '--module',
        'commonjs',
        '--outDir',
        outputPath,
        sourcePath,
      ],
    };
  }

  getRunCommand(_sourcePath: string, outputPath: string): { cmd: string; args: string[] } {
    // tsc --outDir 产出 main.js 在 outputPath 目录下
    return { cmd: 'node', args: [path.join(outputPath, 'main.js')] };
  }

  getReadonlyMounts(): string[] {
    return ['/usr/local/lib/node_modules'];
  }
}
