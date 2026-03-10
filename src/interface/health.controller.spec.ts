import { HealthController } from './health.controller';
import { Queue } from 'bull';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('HealthController', () => {
  let controller: HealthController;

  const mockClient = { ping: jest.fn().mockResolvedValue('PONG') };
  const mockQueue = { client: mockClient };

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.access as jest.Mock).mockResolvedValue(undefined);
    controller = new HealthController(mockQueue as unknown as Queue);
  });

  it('should return ok status when all components are healthy', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.version).toBe('1.0.0');
    expect(typeof result.uptime).toBe('number');
    expect(result.components.redis.status).toBe('ok');
    expect(result.components.disk.status).toBe('ok');
  });

  it('should return degraded status when redis is down', async () => {
    mockClient.ping.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.components.redis.status).toBe('error');
    expect(result.components.redis.message).toContain('Connection refused');
    expect(result.components.disk.status).toBe('ok');
  });

  it('should return degraded status when disk check fails', async () => {
    (fs.access as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.components.disk.status).toBe('error');
    expect(result.components.disk.message).toContain('EACCES');
    expect(result.components.redis.status).toBe('ok');
  });
});
