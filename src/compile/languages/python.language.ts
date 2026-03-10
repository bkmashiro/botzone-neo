import { ILanguage } from './language.interface';

/**
 * Python3 语言配置
 */
export class PythonLanguage implements ILanguage {
  readonly name = 'python';
  readonly extension = '.py';
  readonly needsCompilation = false;

  getCompileCommand(sourcePath: string, _outputPath: string) {
    // Python 不需要编译，但可以做语法检查
    return {
      cmd: 'python3',
      args: ['-m', 'py_compile', sourcePath],
    };
  }

  getExecPath(compiledPath: string): string {
    // 解释型语言：返回 python3 解释器路径，源文件作为参数
    return `python3 ${compiledPath}`;
  }

  getReadonlyMounts(): string[] {
    return ['/usr/lib/python3'];
  }
}
