import { ILanguage } from './language.interface';

/**
 * C++ 语言配置
 */
export class CppLanguage implements ILanguage {
  readonly name = 'cpp';
  readonly extension = '.cpp';
  readonly needsCompilation = true;

  getCompileCommand(sourcePath: string, outputPath: string) {
    return {
      cmd: 'g++',
      args: [
        '-O2',
        '-std=c++17',
        '-DONLINE_JUDGE',
        '-o', outputPath,
        sourcePath,
        '-I/usr/local/include',  // nlohmann/json 头文件路径
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
