import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/** globaldata 文件过期时间（默认 7 天） */
const GLOBALDATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 清理间隔（每小时） */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** 单个 session data 值最大长度（1MB） */
const MAX_SESSION_DATA_LENGTH = 1024 * 1024;

/** globaldata 单个文件最大长度（1MB） */
const MAX_GLOBALDATA_LENGTH = 1024 * 1024;

/** 会话级数据作用域（每个对局独立，并发安全） */
export interface SessionScope {
  getData(botId: string): string;
  setData(botId: string, data: string): void;
  clear(): void;
}

/**
 * 数据持久化服务
 *
 * 管理 Bot 的 data（本局数据）和 globaldata（全局数据）。
 * - data：通过 SessionScope 隔离，每个对局独立
 * - globaldata：文件存储，跨对局持久化，7 天 TTL 自动清理
 */
@Injectable()
export class DataStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataStoreService.name);
  private readonly baseDir: string;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  /** 所有活跃会话 */
  private readonly sessions: Map<string, Map<string, string>> = new Map();

  /** 向后兼容：全局 dataMap（已废弃，请使用 createSession） */
  private readonly dataMap: Map<string, string> = new Map();

  constructor() {
    this.baseDir = path.join(process.cwd(), '.data', 'globaldata');
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredGlobalData().catch((err) => {
        this.logger.warn(`定期清理失败: ${err}`);
      });
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  /** 创建对局级会话作用域（并发安全） */
  createSession(): SessionScope {
    const id = crypto.randomUUID();
    const map = new Map<string, string>();
    this.sessions.set(id, map);
    return {
      getData: (botId: string) => map.get(botId) ?? '',
      setData: (botId: string, data: string) => {
        if (data.length > MAX_SESSION_DATA_LENGTH) {
          this.logger.warn(`Session data 超过 1MB 限制 (botId=${botId})，已截断`);
          map.set(botId, data.slice(0, MAX_SESSION_DATA_LENGTH));
          return;
        }
        map.set(botId, data);
      },
      clear: () => {
        this.sessions.delete(id);
      },
    };
  }

  /** 获取本局持久化数据 */
  async getData(botId: string): Promise<string> {
    return this.dataMap.get(botId) ?? '';
  }

  /** 设置本局持久化数据 */
  async setData(botId: string, data: string): Promise<void> {
    this.dataMap.set(botId, data);
  }

  /** 获取安全的文件路径（防止路径遍历） */
  private safePath(botId: string): string {
    // 使用 sanitize + hash 后缀防止碰撞（如 "bot_1" vs "bot.1"）
    const sanitized = botId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const suffix =
      sanitized !== botId
        ? '-' + crypto.createHash('md5').update(botId).digest('hex').slice(0, 8)
        : '';
    const filePath = path.resolve(this.baseDir, `${sanitized}${suffix}.json`);
    if (!filePath.startsWith(path.resolve(this.baseDir))) {
      throw new Error(`非法 botId: ${botId}`);
    }
    return filePath;
  }

  /** 获取全局持久化数据（过期返回空） */
  async getGlobalData(botId: string): Promise<string> {
    try {
      const filePath = this.safePath(botId);
      const stat = await fs.stat(filePath);
      if (Date.now() - stat.mtimeMs > GLOBALDATA_TTL_MS) {
        await fs.unlink(filePath).catch((unlinkErr) => {
          this.logger.debug(`过期全局数据清理失败 (${botId}): ${unlinkErr}`);
        });
        this.logger.debug(`全局数据已过期并清理: ${botId}`);
        return '';
      }
      return await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      this.logger.debug(`全局数据读取失败 (${botId}): ${err}`);
      return '';
    }
  }

  /** 设置全局持久化数据 */
  async setGlobalData(botId: string, data: string): Promise<void> {
    if (data.length > MAX_GLOBALDATA_LENGTH) {
      this.logger.warn(`globaldata 超过 1MB 限制 (botId=${botId})，已截断`);
      data = data.slice(0, MAX_GLOBALDATA_LENGTH);
    }
    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = this.safePath(botId);
    await fs.writeFile(filePath, data, 'utf-8');
    this.logger.debug(`全局数据已保存: ${botId}`);
  }

  /** 清除本局数据（对局结束时调用） */
  clearSessionData(): void {
    this.dataMap.clear();
  }

  /** 清理所有过期的 globaldata 文件 */
  async cleanupExpiredGlobalData(): Promise<number> {
    try {
      const files = await fs.readdir(this.baseDir);
      let cleaned = 0;
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.baseDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtimeMs > GLOBALDATA_TTL_MS) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch {
          // file may have been deleted concurrently
        }
      }
      if (cleaned > 0) {
        this.logger.log(`清理了 ${cleaned} 个过期 globaldata 文件`);
      }
      return cleaned;
    } catch {
      return 0;
    }
  }
}
