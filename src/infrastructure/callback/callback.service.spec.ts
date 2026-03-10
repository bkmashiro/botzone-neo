import { CallbackService } from './callback.service';

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
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      await service.update('http://cb.test/update', { data: 'test' });

      expect(mockFetch).toHaveBeenCalledWith('http://cb.test/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      });
    });

    it('should handle non-ok responses without throwing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 503, statusText: 'Service Unavailable' }),
      );

      await expect(
        service.update('http://cb.test/update', {}),
      ).resolves.toBeUndefined();
    });

    it('should handle fetch errors without throwing', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.update('http://cb.test/update', {}),
      ).resolves.toBeUndefined();
    });
  });

  describe('finish', () => {
    it('should POST result to the URL', async () => {
      const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      await service.finish('http://cb.test/finish', { done: true });

      expect(mockFetch).toHaveBeenCalledWith('http://cb.test/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true }),
      });
    });

    it('should handle non-ok responses without throwing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(null, { status: 500, statusText: 'Error' }),
      );

      await expect(
        service.finish('http://cb.test/finish', {}),
      ).resolves.toBeUndefined();
    });

    it('should handle fetch errors without throwing', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Timeout'));

      await expect(
        service.finish('http://cb.test/finish', {}),
      ).resolves.toBeUndefined();
    });
  });
});
