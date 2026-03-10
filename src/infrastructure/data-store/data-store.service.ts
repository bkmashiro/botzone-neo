import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 数据持久化服务
 *
 * 管理 Bot 的 data（本局数据）和 globaldata（全局数据）。
 * 当前实现基于文件存储，接口设计支持未来切换到 DB/Redis。
 */
@Injectable()
export class DataStoreService {
  private readonly logger = new Logger(DataStoreService.name);
  private readonly baseDir: string;

  /** 内存缓存：本局 data（仅在对局期间有效） */
  private readonly dataMap: Map<string, string> = new Map();

  constructor() {
    this.baseDir = path.join(process.cwd(), '.data', 'globaldata');
  }

  /** 获取本局持久化数据 */
  async getData(botId: string): Promise<string> {
    return this.dataMap.get(botId) ?? '';
  }

  /** 设置本局持久化数据 */
  async setData(botId: string, data: string): Promise<void> {
    this.dataMap.set(botId, data);
  }

  /** 获取全局持久化数据 */
  async getGlobalData(botId: string): Promise<string> {
    try {
      const filePath = path.join(this.baseDir, `${botId}.json`);
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  /** 设置全局持久化数据 */
  async setGlobalData(botId: string, data: string): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = path.join(this.baseDir, `${botId}.json`);
    await fs.writeFile(filePath, data, 'utf-8');
    this.logger.debug(`全局数据已保存: ${botId}`);
  }

  /** 清除本局数据（对局结束时调用） */
  clearSessionData(): void {
    this.dataMap.clear();
  }
}
