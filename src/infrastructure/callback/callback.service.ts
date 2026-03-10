import { Injectable, Logger } from '@nestjs/common';
import { getRequestId } from '../../interface/request-context';

/** 回调请求超时：10 秒 */
const CALLBACK_TIMEOUT_MS = 10_000;
/** 最终结果回调最大重试次数 */
const FINISH_MAX_RETRIES = 3;
/** 重试间隔基数（毫秒），采用指数退避 */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * 回调服务：向调用方回报对局进度和最终结果
 *
 * - update: 进度回调，best-effort，不重试
 * - finish: 结果回调，最多重试 3 次（指数退避，仅对 5xx/网络错误重试）
 * 所有请求强制 10 秒超时，防止回调 URL 无响应时阻塞评测流程。
 */
@Injectable()
export class CallbackService {
  private readonly logger = new Logger(CallbackService.name);

  /** 回报当前轮次进度 */
  async update(url: string, payload: unknown): Promise<void> {
    try {
      const response = await this.fetchWithTimeout(url, payload);
      if (!response.ok) {
        this.logger.warn(`进度回调失败 (${url}): ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      this.logger.error(`进度回调异常 (${url}): ${err}`);
    }
  }

  /** 回报最终结果（带重试，仅对 5xx/网络错误重试） */
  async finish(url: string, result: unknown): Promise<void> {
    for (let attempt = 0; attempt <= FINISH_MAX_RETRIES; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, result);
        if (response.ok) {
          this.logger.log(`结果已回报: ${url}`);
          return;
        }
        // 4xx 不重试（客户端错误）
        if (response.status >= 400 && response.status < 500) {
          this.logger.warn(`结果回调失败 (${url}): ${response.status} ${response.statusText}`);
          return;
        }
        this.logger.warn(
          `结果回调失败 (${url}): ${response.status}, 重试 ${attempt + 1}/${FINISH_MAX_RETRIES}`,
        );
      } catch (err) {
        this.logger.error(
          `结果回调异常 (${url}): ${err}, 重试 ${attempt + 1}/${FINISH_MAX_RETRIES}`,
        );
      }
      if (attempt < FINISH_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
      }
    }
    this.logger.error(`结果回调最终失败 (${url}): 已用尽 ${FINISH_MAX_RETRIES} 次重试`);
  }

  private async fetchWithTimeout(url: string, payload: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const requestId = getRequestId();
    if (requestId) {
      headers['X-Request-ID'] = requestId;
    }
    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
