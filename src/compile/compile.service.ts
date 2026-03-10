import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CompileResult, Verdict } from '../judge/types';
import { ILanguage } from './languages/language.interface';
import { CppLanguage } from './languages/cpp.language';
import { PythonLanguage } from './languages/python.language';
import { TypeScriptLanguage } from './languages/typescript.language';

/** LRU 缓存条目 */
interface CacheEntry {
  execCmd: string;
  execArgs: string[];
  lastAccess: number;
}

/**
 * 编译服务
 *
 * 支持 C++、Python、TypeScript 的编译/语法检查，
 * 使用 LRU 文件缓存避免重复编译（按 MD5(source+lang) 缓存）。
 */
@Injectable()
export class CompileService {
  private readonly logger = new Logger(CompileService.name);
  private readonly languages: Map<string, ILanguage> = new Map();
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly cacheDir: string;
  private readonly timeLimitMs: number;
  private readonly maxCacheSize = 200;

  constructor(private readonly configService: ConfigService) {
    // 注册支持的语言
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
   * @param language 编程语言标识
   * @param source 源代码内容
   * @returns 编译结果
   */
  async compile(language: string, source: string): Promise<CompileResult> {
    const lang = this.languages.get(language);
    if (!lang) {
      return { verdict: 'CE' as Verdict, message: `不支持的语言: ${language}` };
    }

    // 计算缓存 key
    const hash = crypto.createHash('md5').update(`${language}:${source}`).digest('hex');

    // 检查缓存
    const cached = this.cache.get(hash);
    if (cached) {
      // 验证关键文件是否仍存在
      const checkPath =
        cached.execArgs.length > 0 ? cached.execArgs[0] : cached.execCmd;
      try {
        await fs.access(checkPath);
        cached.lastAccess = Date.now();
        this.logger.debug(`编译缓存命中: ${hash}`);
        return {
          verdict: 'OK',
          execCmd: cached.execCmd,
          execArgs: cached.execArgs,
        };
      } catch {
        this.cache.delete(hash);
      }
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
      return {
        verdict: 'CE' as Verdict,
        message: result.stderr || result.stdout || '编译失败',
      };
    }

    // 获取运行命令
    const runCmd = lang.getRunCommand(sourcePath, outputPath);

    // 更新缓存
    this.cache.set(hash, {
      execCmd: runCmd.cmd,
      execArgs: runCmd.args,
      lastAccess: Date.now(),
    });
    this.evictCache();

    return { verdict: 'OK', execCmd: runCmd.cmd, execArgs: runCmd.args };
  }

  /** 获取语言配置 */
  getLanguage(name: string): ILanguage | undefined {
    return this.languages.get(name);
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

  /** LRU 缓存淘汰 */
  private evictCache(): void {
    if (this.cache.size <= this.maxCacheSize) return;

    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

    const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
    for (const [key] of toRemove) {
      this.cache.delete(key);
      // 异步清理文件，不阻塞主流程
      const dir = path.join(this.cacheDir, key);
      fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
