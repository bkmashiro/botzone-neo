import { BadRequestException } from '@nestjs/common';

jest.mock('../application/run-match.usecase', () => ({
  RunMatchUseCase: jest.fn(),
}));

jest.mock('../application/run-oj.usecase', () => ({
  RunOJUseCase: jest.fn(),
}));

import { JudgeController } from './judge.controller';
import { JudgeQueueService } from './judge-queue.service';

describe('JudgeController', () => {
  let controller: JudgeController;

  const mockQueueService = { enqueue: jest.fn().mockResolvedValue('job-456') };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new JudgeController(mockQueueService as unknown as JudgeQueueService);
  });

  const botzoneBody = {
    type: 'botzone',
    game: {
      judger: { language: 'cpp', source: 'code', limit: { time: 1000, memory: 256 } },
      '0': { language: 'cpp', source: 'code', limit: { time: 1000, memory: 256 } },
    },
    callback: { update: 'http://update', finish: 'http://finish' },
  };

  const ojBody = {
    type: 'oj',
    source: 'int main() {}',
    language: 'cpp',
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
    callback: { finish: 'http://finish' },
    judgeMode: 'standard',
  };

  describe('submitTask', () => {
    it('should accept a valid botzone task and return job id', async () => {
      const result = await controller.submitTask(botzoneBody);

      expect(result.jobId).toBe('job-456');
      expect(mockQueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'botzone' }),
      );
    });

    it('should accept a valid oj task and return job id', async () => {
      const result = await controller.submitTask(ojBody);

      expect(result.jobId).toBe('job-456');
      expect(mockQueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'oj' }),
      );
    });

    it('should throw BadRequestException for unknown type', async () => {
      await expect(controller.submitTask({ type: 'unknown' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateBotzoneTask', () => {
    it('should throw when game is missing', async () => {
      const body = { type: 'botzone', callback: { finish: 'http://finish' } };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when callback is missing', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: 'code', limit: { time: 1000, memory: 256 } },
        },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when source exceeds 64KB limit', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: {
            language: 'cpp',
            source: 'x'.repeat(65537),
            limit: { time: 1000, memory: 256 },
          },
        },
        callback: { update: 'http://update', finish: 'http://finish' },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when time limit is invalid', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: {
            language: 'cpp',
            source: 'code',
            limit: { time: 0, memory: 256 },
          },
        },
        callback: { update: 'http://update', finish: 'http://finish' },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateOJTask', () => {
    it('should throw when source is missing', async () => {
      const body = {
        type: 'oj',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when testcases are missing', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when testcase input exceeds 10MB limit', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: 'x'.repeat(10 * 1024 * 1024 + 1), expectedOutput: '1\n' }],
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });
  });
});
