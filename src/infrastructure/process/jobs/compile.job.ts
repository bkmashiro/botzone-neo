/**
 * CompileJob — Code → CompiledArtifact
 *
 * 纯编译逻辑：语言分发 + 执行编译器 + 返回编译产物。
 * 不含缓存（缓存由上层 CompileService 管理）。
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IJob } from './job.interface';
import { ILanguage } from '../../compile/languages/language.interface';
import { CompiledArtifact } from './compile.job.types';
import { CompileError } from '../../../domain/verdict';

/** CompileJob 输入 */
export interface CompileInput {
  /** 编程语言标识 */
  language: string;
  /** 源代码内容 */
  source: string;
  /** 编译输出目录（由调用方指定） */
  workDir: string;
}

/**
 * 编译 Job：接收源代码，执行编译器，返回编译产物。
 * 编译失败时抛出 CompileError。
 */
export class CompileJob implements IJob<CompileInput, CompiledArtifact> {
  constructor(
    private readonly languages: Map<string, ILanguage>,
    private readonly timeLimitMs: number = 10_000,
  ) {}

  async execute(input: CompileInput): Promise<CompiledArtifact> {
    const lang = this.languages.get(input.language);
    if (!lang) {
      throw new CompileError(`不支持的语言: ${input.language}`);
    }

    // 确保工作目录存在
    await fs.mkdir(input.workDir, { recursive: true });

    const sourcePath = path.join(input.workDir, `main${lang.extension}`);
    const outputPath = path.join(input.workDir, 'main');
    await fs.writeFile(sourcePath, input.source, 'utf-8');

    // 执行编译
    const { cmd, args } = lang.getCompileCommand(sourcePath, outputPath);
    const result = await this.runCompiler(cmd, args);

    if (result.exitCode !== 0) {
      throw new CompileError(
        result.stderr || result.stdout || '编译失败',
        result.stderr || result.stdout,
      );
    }

    // 获取运行命令
    const runCmd = lang.getRunCommand(sourcePath, outputPath);

    return {
      cmd: runCmd.cmd,
      args: runCmd.args,
      language: input.language,
      readonlyMounts: lang.getReadonlyMounts(),
      workDir: input.workDir,
    };
  }

  /** 执行编译器进程 */
  private runCompiler(cmd: string, args: string[]): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ stdout, stderr: '编译超时', exitCode: -1 });
      }, this.timeLimitMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
