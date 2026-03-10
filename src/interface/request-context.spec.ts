import { requestContext, getRequestId } from './request-context';

describe('RequestContext', () => {
  it('should return undefined when no context is active', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('should return requestId within a context run', () => {
    requestContext.run({ requestId: 'test-123' }, () => {
      expect(getRequestId()).toBe('test-123');
    });
  });

  it('should isolate contexts between concurrent runs', async () => {
    const results: string[] = [];

    await Promise.all([
      new Promise<void>((resolve) => {
        requestContext.run({ requestId: 'req-a' }, () => {
          setTimeout(() => {
            results.push(getRequestId()!);
            resolve();
          }, 10);
        });
      }),
      new Promise<void>((resolve) => {
        requestContext.run({ requestId: 'req-b' }, () => {
          setTimeout(() => {
            results.push(getRequestId()!);
            resolve();
          }, 5);
        });
      }),
    ]);

    expect(results).toContain('req-a');
    expect(results).toContain('req-b');
  });

  it('should return undefined after context exits', () => {
    requestContext.run({ requestId: 'temp' }, () => {
      expect(getRequestId()).toBe('temp');
    });
    expect(getRequestId()).toBeUndefined();
  });
});
