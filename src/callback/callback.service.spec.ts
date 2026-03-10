import { CallbackService } from './callback.service';

describe('CallbackService (src/callback)', () => {
  let service: CallbackService;

  beforeEach(() => {
    service = new CallbackService();
    jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('update', () => {
    it('should POST payload as JSON to the given URL', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      await service.update('http://example.com/update', { round: 1 });

      expect(mockFetch).toHaveBeenCalledWith('http://example.com/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round: 1 }),
      });
    });

    it('should log warning when response is not ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 500, statusText: 'Internal Server Error' }),
      );

      // Should not throw
      await service.update('http://example.com/update', { round: 1 });
    });

    it('should catch fetch errors without throwing', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      await expect(
        service.update('http://example.com/update', { round: 1 }),
      ).resolves.toBeUndefined();
    });
  });

  describe('finish', () => {
    it('should POST result as JSON to the given URL', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      const result = { scores: { '0': 1, '1': 0 }, log: [], compile: {} };
      await service.finish('http://example.com/finish', result);

      expect(mockFetch).toHaveBeenCalledWith('http://example.com/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
    });

    it('should log warning when response is not ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 502, statusText: 'Bad Gateway' }),
      );

      await service.finish('http://example.com/finish', {
        scores: {},
        log: [],
        compile: {},
      });
    });

    it('should catch fetch errors without throwing', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Timeout'));

      await expect(
        service.finish('http://example.com/finish', {
          scores: {},
          log: [],
          compile: {},
        }),
      ).resolves.toBeUndefined();
    });
  });
});
