import { ILanguage } from './language.interface';

export class PythonLanguage implements ILanguage {
  readonly name = 'python';
  readonly extension = '.py';
  readonly needsCompilation = false;

  getCompileCommand(sourcePath: string, _outputPath: string) {
    return {
      cmd: 'python3',
      args: ['-m', 'py_compile', sourcePath],
    };
  }

  getRunCommand(sourcePath: string, _outputPath: string) {
    return { cmd: 'python3', args: [sourcePath] };
  }

  getReadonlyMounts(): string[] {
    return ['/usr/lib/python3'];
  }
}
