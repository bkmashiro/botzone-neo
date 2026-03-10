import { ILanguage } from './language.interface';

/**
 * TypeScript (Node.js) 语言配置
 */
export class TypeScriptLanguage implements ILanguage {
  readonly name = 'typescript';
  readonly extension = '.ts';
  readonly needsCompilation = true;

  getCompileCommand(sourcePath: string, outputPath: string) {
    // 使用 tsc 编译为 JavaScript
    return {
      cmd: 'tsc',
      args: [
        '--strict',
        '--target', 'ES2021',
        '--module', 'commonjs',
        '--outDir', outputPath,
        sourcePath,
      ],
    };
  }

  getExecPath(compiledPath: string): string {
    // 编译后的 .js 文件通过 node 运行
    return `node ${compiledPath}`;
  }

  getReadonlyMounts(): string[] {
    return ['/usr/local/lib/node_modules'];
  }
}
