/**
 * 编译服务
 *
 * 支持 C++、Python、TypeScript 的编译/语法检查，
 * 使用 LRU 文件缓存避免重复编译（按 MD5(source+lang) 缓存）。
 *
 * 成功返回 CompiledBot，失败抛出 CompileError。
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Counter } from 'prom-client';
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: APP_VERSION } = require('../../../package.json') as { version: string };
const tracer = trace.getTracer('botzone-neo', APP_VERSION);

@Injectable()
export class CompileService {
  private readonly logger = new Logger(CompileService.name);
  private readonly languages: Map<string, ILanguage> = new Map();
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly cacheDir: string;
  private readonly timeLimitMs: number;
  private readonly maxCacheSize: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectMetric('botzone_compile_cache_hits_total') private readonly cacheHits: Counter,
    @InjectMetric('botzone_compile_cache_misses_total') private readonly cacheMisses: Counter,
  ) {
    const langs: ILanguage[] = [new CppLanguage(), new PythonLanguage(), new TypeScriptLanguage()];
    for (const lang of langs) {
      this.languages.set(lang.name, lang);
    }

    this.cacheDir = path.join(process.cwd(), '.cache', 'compile');
    this.timeLimitMs = this.configService.get<number>('COMPILE_TIME_LIMIT_MS', 10000);
    this.maxCacheSize = this.configService.get<number>('COMPILE_CACHE_SIZE', 200);
  }

  /**
   * 编译源代码
   *
   * @returns CompiledBot
   * @throws CompileError
   */
  async compile(language: string, source: string): Promise<CompiledBot> {
    return tracer.startActiveSpan('CompileService.compile', async (span) => {
      span.setAttribute('compile.language', language);

      try {
        const lang = this.languages.get(language);
        if (!lang) {
          throw new CompileError(`不支持的语言: ${language}`);
        }

        const hash = crypto.createHash('md5').update(`${language}:${source}`).digest('hex');

        // 检查缓存（验证编译产物仍存在）
        const cached = this.cache.get(hash);
        if (cached) {
          try {
            // 验证运行目标文件仍存在（C++ → 二进制, Python → 源码, TS → 编译后 JS）
            const cachePrefix = path.resolve(this.cacheDir);
            const runTarget = path.resolve(cached.compiled.cmd).startsWith(cachePrefix)
              ? cached.compiled.cmd
              : cached.compiled.args[0];
            if (runTarget) {
              await fs.access(runTarget);
            }
            cached.lastAccess = Date.now();
            this.cacheHits.inc();
            span.setAttribute('compile.cacheHit', true);
            this.logger.debug(`编译缓存命中: ${hash}`);
            return cached.compiled;
          } catch {
            this.logger.debug(`缓存文件已失效，重新编译: ${hash}`);
            this.cache.delete(hash);
          }
        }

        span.setAttribute('compile.cacheHit', false);
        this.cacheMisses.inc();

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
      } catch (err) {
        span.recordException(err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        span.end();
      }
    });
  }

  getLanguage(name: string): ILanguage | undefined {
    return this.languages.get(name);
  }

  private runCompiler(
    cmd: string,
    args: string[],
  ): Promise<{
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
      const maxOutput = 64 * 1024; // 64KB max compiler output

      child.stdout.on('data', (data: Buffer) => {
        if (stdout.length < maxOutput) stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        if (stderr.length < maxOutput) stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ stdout, stderr: '编译超时', exitCode: -1 });
      }, this.timeLimitMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        if (stderr.length >= maxOutput) stderr += '\n... (output truncated)';
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private evictCache(): void {
    while (this.cache.size > this.maxCacheSize) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
      const dir = path.join(this.cacheDir, oldestKey);
      fs.rm(dir, { recursive: true, force: true }).catch((err) => {
        this.logger.warn(`缓存清理失败: ${dir}: ${err}`);
      });
    }
  }
}
