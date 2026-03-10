import { ILanguage } from './language.interface';

/**
 * Python3 语言配置
 */
export class PythonLanguage implements ILanguage {
  readonly name = 'python';
  readonly extension = '.py';
  readonly needsCompilation = false;

  getCompileCommand(sourcePath: string, _outputPath: string): { cmd: string; args: string[] } {
    // Python 不需要编译，但做语法检查
    return {
      cmd: 'python3',
      args: ['-m', 'py_compile', sourcePath],
    };
  }

  getRunCommand(sourcePath: string, _outputPath: string): { cmd: string; args: string[] } {
    return { cmd: 'python3', args: [sourcePath] };
  }

  getReadonlyMounts(): string[] {
    return ['/usr/lib/python3'];
  }
}
