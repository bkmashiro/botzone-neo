import { Queue, Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { MatchTask } from '../domain/match';
import { OJTask } from '../domain/oj/testcase';

jest.mock('../application/run-match.usecase', () => ({
  RunMatchUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn(),
  })),
}));

jest.mock('../application/run-oj.usecase', () => ({
  RunOJUseCase: jest.fn().mockImplementation(() => ({
    execute: jest.fn(),
  })),
}));

import { JudgeQueueService } from './judge-queue.service';
import { RunMatchUseCase } from '../application/run-match.usecase';
import { RunOJUseCase } from '../application/run-oj.usecase';

describe('JudgeQueueService', () => {
  let service: JudgeQueueService;

  const mockQueue: Record<string, jest.Mock> = {
    add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    process: jest.fn(),
    pause: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn(),
  };
  const mockRunMatch = { execute: jest.fn().mockResolvedValue(undefined) };
  const mockRunOJ = { execute: jest.fn().mockResolvedValue(undefined) };
  const mockConfig = { get: jest.fn().mockReturnValue(15) };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JudgeQueueService(
      mockQueue as unknown as Queue,
      mockRunMatch as unknown as RunMatchUseCase,
      mockRunOJ as unknown as RunOJUseCase,
      mockConfig as unknown as ConfigService,
    );
  });

  describe('onModuleInit', () => {
    it('should register processor with configured concurrency', async () => {
      mockQueue.process = jest.fn();
      await service.onModuleInit();
      expect(mockConfig.get).toHaveBeenCalledWith('JUDGE_CONCURRENCY', '15');
      expect(mockQueue.process).toHaveBeenCalledWith('run', 15, expect.any(Function));
    });
  });

  describe('enqueue', () => {
    it('should add job to queue and return job id', async () => {
      const data = { type: 'botzone' as const, task: {} as MatchTask };
      const result = await service.enqueue(data);

      expect(mockQueue.add).toHaveBeenCalledWith('run', data, {
        removeOnComplete: 100,
        removeOnFail: 200,
        timeout: 10 * 60 * 1000,
      });
      expect(result).toBe('job-123');
    });
  });

  describe('onApplicationShutdown', () => {
    it('should pause and close the queue', async () => {
      await service.onApplicationShutdown();

      expect(mockQueue.pause).toHaveBeenCalledWith(true);
      expect(mockQueue.close).toHaveBeenCalled();
    });

    it('should log warning when close() rejects', async () => {
      mockQueue.close.mockRejectedValueOnce(new Error('redis gone'));
      await service.onApplicationShutdown('SIGTERM');
      expect(mockQueue.pause).toHaveBeenCalledWith(true);
    });

    it('should resolve when close() takes longer than grace period', async () => {
      jest.useFakeTimers();
      mockQueue.close.mockReturnValueOnce(new Promise(() => {}));
      const promise = service.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(30_000);
      await promise;
      jest.useRealTimers();
    });
  });

  describe('getJobStatus', () => {
    it('should return null when the job does not exist', async () => {
      mockQueue.getJob.mockResolvedValueOnce(null);

      await expect(service.getJobStatus('missing')).resolves.toBeNull();
    });

    it('should return job details without optional fields when absent', async () => {
      mockQueue.getJob.mockResolvedValueOnce({
        id: 'job-5',
        data: { type: 'botzone' },
        finishedOn: undefined,
        failedReason: undefined,
        getState: jest.fn().mockResolvedValue('active'),
      });

      const result = await service.getJobStatus('job-5');
      expect(result).toEqual({
        jobId: 'job-5',
        state: 'active',
        type: 'botzone',
      });
      expect(result).not.toHaveProperty('finishedOn');
      expect(result).not.toHaveProperty('failedReason');
    });

    it('should return job details when the job exists', async () => {
      mockQueue.getJob.mockResolvedValueOnce({
        id: 'job-9',
        data: { type: 'oj' },
        finishedOn: 1700000000000,
        failedReason: 'timeout',
        getState: jest.fn().mockResolvedValue('failed'),
      });

      await expect(service.getJobStatus('job-9')).resolves.toEqual({
        jobId: 'job-9',
        state: 'failed',
        type: 'oj',
        finishedOn: new Date(1700000000000).toISOString(),
        failedReason: 'timeout',
      });
    });
  });

  describe('processTask (via onModuleInit)', () => {
    let processor: (job: Job) => Promise<void>;

    beforeEach(async () => {
      mockQueue.process = jest.fn();
      await service.onModuleInit();
      // Extract the registered processor function
      processor = (mockQueue.process as jest.Mock).mock.calls[0][2];
    });

    it('should dispatch to runMatchUseCase for botzone type', async () => {
      const task = { type: 'botzone', bots: [] } as unknown as MatchTask;
      const job = { id: '1', data: { type: 'botzone', task } } as unknown as Job;

      await processor(job);

      expect(mockRunMatch.execute).toHaveBeenCalledWith(task);
      expect(mockRunOJ.execute).not.toHaveBeenCalled();
    });

    it('should dispatch to runOJUseCase for oj type', async () => {
      const task = { type: 'oj', source: 'code' } as unknown as OJTask;
      const job = { id: '2', data: { type: 'oj', task } } as unknown as Job;

      await processor(job);

      expect(mockRunOJ.execute).toHaveBeenCalledWith(task);
      expect(mockRunMatch.execute).not.toHaveBeenCalled();
    });

    it('should re-throw errors from use cases', async () => {
      const error = new Error('execution failed');
      mockRunMatch.execute.mockRejectedValueOnce(error);

      const task = { type: 'botzone', bots: [] } as unknown as MatchTask;
      const job = { id: '3', data: { type: 'botzone', task } } as unknown as Job;

      await expect(processor(job)).rejects.toThrow('execution failed');
    });
  });
});
