import { Injectable, Logger } from '@nestjs/common';
import { GameResult } from '../judge/types';

/**
 * 回调服务：向调用方回报对局进度和最终结果
 */
@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);

  /** 回报当前轮次进度 */
  async update(url: string, payload: unknown): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        this.logger.warn(`进度回调失败: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      this.logger.error(`进度回调异常: ${err}`);
    }
  }

  /** 回报对局最终结果 */
  async finish(url: string, result: GameResult): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      if (!response.ok) {
        this.logger.warn(`结果回调失败: ${response.status} ${response.statusText}`);
      } else {
        this.logger.log('对局结果已回报');
      }
    } catch (err) {
      this.logger.error(`结果回调异常: ${err}`);
    }
  }
}
