/**
 * CompileService — LRU 缓存 + CompileJob 注入
 *
 * 上层通过此服务编译代码，自动 LRU 缓存避免重复编译。
 * 内部委托 CompileJob 执行实际编译。
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CompileJob, CompileInput } from '../process/jobs/compile.job';
import { CompiledArtifact } from '../process/jobs/compile.job.types';
import { ILanguage } from './languages/language.interface';
import { CppLanguage } from './languages/cpp.language';
import { PythonLanguage } from './languages/python.language';
import { TypeScriptLanguage } from './languages/typescript.language';
import { CompileError } from '../../domain/verdict';

/** LRU 缓存条目 */
interface CacheEntry {
  artifact: CompiledArtifact;
  lastAccess: number;
}

@Injectable()
export class CompileService {
  private readonly logger = new Logger(CompileService.name);
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly cacheDir: string;
  private readonly maxCacheSize = 200;
  private readonly compileJob: CompileJob;

  constructor(private readonly configService: ConfigService) {
    // 注册支持的语言
    const languages = new Map<string, ILanguage>();
    const langs: ILanguage[] = [
      new CppLanguage(),
      new PythonLanguage(),
      new TypeScriptLanguage(),
    ];
    for (const lang of langs) {
      languages.set(lang.name, lang);
    }

    this.cacheDir = path.join(process.cwd(), '.cache', 'compile');
    const timeLimitMs = this.configService.get<number>('COMPILE_TIME_LIMIT_MS', 10000);
    this.compileJob = new CompileJob(languages, timeLimitMs);
  }

  /**
   * 编译源代码（带 LRU 缓存）
   *
   * @returns 编译产物
   * @throws CompileError 编译失败时抛出
   */
  async compile(language: string, source: string): Promise<CompiledArtifact> {
    const hash = crypto.createHash('md5').update(`${language}:${source}`).digest('hex');

    // 检查缓存
    const cached = this.cache.get(hash);
    if (cached) {
      // 验证产物文件是否仍存在
      const checkPath = cached.artifact.args.length > 0
        ? cached.artifact.args[0]
        : cached.artifact.cmd;
      try {
        await fs.access(checkPath);
        cached.lastAccess = Date.now();
        this.logger.debug(`编译缓存命中: ${hash}`);
        return cached.artifact;
      } catch {
        this.cache.delete(hash);
      }
    }

    // 缓存未命中，执行编译
    const workDir = path.join(this.cacheDir, hash);
    const input: CompileInput = { language, source, workDir };
    const artifact = await this.compileJob.execute(input);

    // 写入缓存
    this.cache.set(hash, { artifact, lastAccess: Date.now() });
    this.evictCache();

    this.logger.debug(`编译完成: ${hash}`);
    return artifact;
  }

  /** LRU 缓存淘汰 */
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
