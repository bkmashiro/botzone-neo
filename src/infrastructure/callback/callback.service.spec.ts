import { CallbackService } from './callback.service';
import { requestContext } from '../../interface/request-context';

describe('CallbackService (infrastructure)', () => {
  let service: CallbackService;

  beforeEach(() => {
    service = new CallbackService();
    jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('update', () => {
    it('should POST payload to the URL', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      await service.update('http://cb.test/update', { data: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://cb.test/update',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'test' }),
        }),
      );
    });

    it('should handle non-ok responses without throwing', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 503, statusText: 'Service Unavailable' }));

      await expect(service.update('http://cb.test/update', {})).resolves.toBeUndefined();
    });

    it('should handle fetch errors without throwing', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.update('http://cb.test/update', {})).resolves.toBeUndefined();
    });
  });

  describe('finish', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should POST result to the URL', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      await service.finish('http://cb.test/finish', { done: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://cb.test/finish',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ done: true }),
        }),
      );
    });

    it('should not retry on 4xx response', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 404, statusText: 'Not Found' }));

      await service.finish('http://cb.test/finish', {});

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 429 Too Many Requests', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 429, statusText: 'Too Many Requests' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const finishPromise = service.finish('http://cb.test/finish', {});
      await jest.advanceTimersByTimeAsync(1000);
      await finishPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 408 Request Timeout', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 408, statusText: 'Request Timeout' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const finishPromise = service.finish('http://cb.test/finish', {});
      await jest.advanceTimersByTimeAsync(1000);
      await finishPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 5xx response and succeed on retry', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(new Response(null, { status: 500, statusText: 'Error' }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const finishPromise = service.finish('http://cb.test/finish', {});
      await jest.advanceTimersByTimeAsync(1000);
      await finishPromise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on network errors and exhaust retries', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      const finishPromise = service.finish('http://cb.test/finish', {});
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(4000);
      await finishPromise;

      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
  });

  describe('X-Request-ID forwarding', () => {
    it('should include X-Request-ID header when request context is set', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      await requestContext.run({ requestId: 'test-req-123' }, async () => {
        await service.update('http://cb.test/update', { data: 'test' });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://cb.test/update',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'test-req-123' },
        }),
      );
    });

    it('should not include X-Request-ID header when request context is absent', async () => {
      const mockFetch = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      await service.update('http://cb.test/update', { data: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://cb.test/update',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });
});
