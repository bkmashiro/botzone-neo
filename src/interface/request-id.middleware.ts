/**
 * Request ID 中间件
 *
 * 为每个请求分配唯一 ID（使用客户端提供的 X-Request-ID 或自动生成）。
 * 在响应头中返回 X-Request-ID，并通过 AsyncLocalStorage 传递到服务层。
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { requestContext } from './request-context';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    requestContext.run({ requestId }, () => next());
  }
}
