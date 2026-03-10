/**
 * 编译服务
 *
 * 支持 C++、Python、TypeScript 的编译/语法检查，
 * 使用 LRU 文件缓存避免重复编译（按 MD5(source+lang) 缓存）。
 *
 * 成功返回 CompiledBot，失败抛出 CompileError。
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CompiledBot } from '../../domain/bot';
import { CompileError } from '../../domain/verdict';
import { ILanguage } from './languages/language.interface';
import { CppLanguage } from './languages/cpp.language';
import { PythonLanguage } from './languages/python.language';
import { TypeScriptLanguage } from './languages/typescript.language';

interface CacheEntry {
  compiled: CompiledBot;
  lastAccess: number;
}

@Injectable()
export class CompileService {
  private readonly logger = new Logger(CompileService.name);
  private readonly languages: Map<string, ILanguage> = new Map();
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly cacheDir: string;
  private readonly timeLimitMs: number;
  private readonly maxCacheSize = 200;

  constructor(private readonly configService: ConfigService) {
    const langs: ILanguage[] = [
      new CppLanguage(),
      new PythonLanguage(),
      new TypeScriptLanguage(),
    ];
    for (const lang of langs) {
      this.languages.set(lang.name, lang);
    }

    this.cacheDir = path.join(process.cwd(), '.cache', 'compile');
    this.timeLimitMs = this.configService.get<number>('COMPILE_TIME_LIMIT_MS', 10000);
  }

  /**
   * 编译源代码
   *
   * @returns CompiledBot
   * @throws CompileError
   */
  async compile(language: string, source: string): Promise<CompiledBot> {
    const lang = this.languages.get(language);
    if (!lang) {
      throw new CompileError(`不支持的语言: ${language}`);
    }

    const hash = crypto.createHash('md5').update(`${language}:${source}`).digest('hex');

    // 检查缓存
    const cached = this.cache.get(hash);
    if (cached) {
      cached.lastAccess = Date.now();
      this.logger.debug(`编译缓存命中: ${hash}`);
      return cached.compiled;
    }

    // 准备编译目录
    const compileDir = path.join(this.cacheDir, hash);
    await fs.mkdir(compileDir, { recursive: true });

    const sourcePath = path.join(compileDir, `main${lang.extension}`);
    const outputPath = path.join(compileDir, 'main');
    await fs.writeFile(sourcePath, source, 'utf-8');

    // 执行编译
    const { cmd, args } = lang.getCompileCommand(sourcePath, outputPath);
    this.logger.debug(`编译命令: ${cmd} ${args.join(' ')}`);

    const result = await this.runCompiler(cmd, args);

    if (result.exitCode !== 0) {
      throw new CompileError(
        result.stderr || result.stdout || '编译失败',
        result.stderr || result.stdout,
      );
    }

    // 构建 CompiledBot
    const runCmd = lang.getRunCommand(sourcePath, outputPath);
    const compiled: CompiledBot = {
      cmd: runCmd.cmd,
      args: runCmd.args,
      language: lang.name,
      readonlyMounts: lang.getReadonlyMounts(),
    };

    // 更新缓存
    this.cache.set(hash, { compiled, lastAccess: Date.now() });
    this.evictCache();

    return compiled;
  }

  getLanguage(name: string): ILanguage | undefined {
    return this.languages.get(name);
  }

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

  private evictCache(): void {
    if (this.cache.size <= this.maxCacheSize) return;

    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
    for (const [key] of toRemove) {
      this.cache.delete(key);
      const dir = path.join(this.cacheDir, key);
      fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
