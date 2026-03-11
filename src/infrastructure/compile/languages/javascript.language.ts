import { ILanguage } from './language.interface';

/**
 * JavaScript (Node.js) language configuration.
 * No compilation step — syntax is checked with `node --check`.
 */
export class JavaScriptLanguage implements ILanguage {
  readonly name = 'javascript';
  readonly extension = '.js';
  readonly needsCompilation = false;

  getCompileCommand(sourcePath: string, _outputPath: string): { cmd: string; args: string[] } {
    // Syntax-check only; no binary output needed
    return {
      cmd: 'node',
      args: ['--check', sourcePath],
    };
  }

  getRunCommand(sourcePath: string, _outputPath: string): { cmd: string; args: string[] } {
    return { cmd: 'node', args: [sourcePath] };
  }

  getReadonlyMounts(): string[] {
    return ['/usr/local/lib/node_modules'];
  }
}
