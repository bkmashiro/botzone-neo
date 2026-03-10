import { RequestIdMiddleware } from './request-id.middleware';
import { Request, Response } from 'express';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
  });

  it('should use the existing X-Request-ID header when present', () => {
    const req = { headers: { 'x-request-id': 'existing-id' } } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toBe('existing-id');
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', 'existing-id');
    expect(next).toHaveBeenCalled();
  });

  it('should generate a UUID when X-Request-ID is not present', () => {
    const req = { headers: {} } as unknown as Request;
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Response;
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', req.headers['x-request-id']);
    expect(next).toHaveBeenCalled();
  });
});
