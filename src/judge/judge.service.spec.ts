import { JudgeService } from './judge.service';
import { MatchRunner } from './match-runner';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bull';
import { TaskDto } from './dto/task.dto';

describe('JudgeService', () => {
  let service: JudgeService;
  let mockQueue: jest.Mocked<Queue>;
  let mockMatchRunner: jest.Mocked<MatchRunner>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 42 }),
    } as any;

    mockMatchRunner = {
      run: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockConfigService = {
      get: jest.fn((key: string, defaultVal: unknown) => {
        if (key === 'TRUST_IP') return '10.0.0.1, 10.0.0.2';
        if (key === 'JUDGE_CAPABILITY') return 8;
        return defaultVal;
      }),
    } as any;

    service = new JudgeService(mockQueue, mockMatchRunner, mockConfigService);
  });

  describe('enqueue', () => {
    it('should add task to the queue and return job id', async () => {
      const task = { game: {}, callback: { update: '', finish: '' } } as TaskDto;
      const jobId = await service.enqueue(task);

      expect(jobId).toBe('42');
      expect(mockQueue.add).toHaveBeenCalledWith('run', task, {
        removeOnComplete: 100,
        removeOnFail: 200,
      });
    });
  });

  describe('getTrustIps', () => {
    it('should split comma-separated TRUST_IP and trim whitespace', () => {
      const ips = service.getTrustIps();
      expect(ips).toEqual(['10.0.0.1', '10.0.0.2']);
    });

    it('should default to 127.0.0.1 when TRUST_IP is not set', () => {
      mockConfigService.get.mockImplementation((key: string, defaultVal: unknown) => {
        if (key === 'TRUST_IP') return '127.0.0.1';
        return defaultVal;
      });
      const ips = service.getTrustIps();
      expect(ips).toEqual(['127.0.0.1']);
    });
  });

  describe('getConcurrency', () => {
    it('should return configured JUDGE_CAPABILITY', () => {
      expect(service.getConcurrency()).toBe(8);
    });
  });

  describe('processTask', () => {
    it('should call matchRunner.run with job data', async () => {
      const task = { game: {}, callback: { update: '', finish: '' } } as TaskDto;
      const job = { id: 1, data: task } as Job<TaskDto>;

      await service.processTask(job);

      expect(mockMatchRunner.run).toHaveBeenCalledWith(task);
    });

    it('should rethrow errors from matchRunner.run', async () => {
      const error = new Error('match failed');
      mockMatchRunner.run.mockRejectedValue(error);

      const task = { game: {}, callback: { update: '', finish: '' } } as TaskDto;
      const job = { id: 2, data: task } as Job<TaskDto>;

      await expect(service.processTask(job)).rejects.toThrow('match failed');
    });
  });
});
