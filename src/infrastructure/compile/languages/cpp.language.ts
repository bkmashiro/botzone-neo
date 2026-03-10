import { ILanguage } from './language.interface';

export class CppLanguage implements ILanguage {
  readonly name = 'cpp';
  readonly extension = '.cpp';
  readonly needsCompilation = true;

  getCompileCommand(sourcePath: string, outputPath: string) {
    return {
      cmd: 'g++',
      args: [
        '-O2', '-std=c++17', '-DONLINE_JUDGE',
        '-o', outputPath,
        sourcePath,
        '-I/usr/local/include',
      ],
    };
  }

  getRunCommand(_sourcePath: string, outputPath: string) {
    return { cmd: outputPath, args: [] };
  }

  getReadonlyMounts(): string[] {
    return ['/usr/local/include'];
  }
}
