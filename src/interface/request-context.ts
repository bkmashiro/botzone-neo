/**
 * 请求上下文：通过 AsyncLocalStorage 在请求生命周期内传递 requestId
 *
 * 用法：
 * - 中间件中调用 requestContext.run() 设置上下文
 * - 任意服务层调用 getRequestId() 获取当前请求 ID
 */

import { AsyncLocalStorage } from 'async_hooks';

interface RequestStore {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

/** 获取当前请求的 ID（无上下文时返回 undefined） */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
