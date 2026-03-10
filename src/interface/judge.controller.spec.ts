import { BadRequestException, NotFoundException } from '@nestjs/common';

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

  const mockQueueService: Record<string, jest.Mock> = {
    enqueue: jest.fn().mockResolvedValue('job-456'),
    getJobStatus: jest.fn(),
  };

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

  describe('getJobStatus', () => {
    it('should return job status when job exists', async () => {
      const status = { jobId: 'job-1', state: 'completed', type: 'botzone' };
      mockQueueService.getJobStatus.mockResolvedValue(status);

      const result = await controller.getJobStatus('job-1');
      expect(result).toEqual(status);
    });

    it('should throw NotFoundException when job does not exist', async () => {
      mockQueueService.getJobStatus.mockResolvedValue(null);

      await expect(controller.getJobStatus('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

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

    it('should throw when language is missing on a bot', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: { source: 'code', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://update', finish: 'http://finish' },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when source is missing on a bot', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: { language: 'cpp', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://update', finish: 'http://finish' },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when limit is missing on a bot', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: 'code' },
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

    it('should throw when memory limit is invalid', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: {
            language: 'cpp',
            source: 'code',
            limit: { time: 1000, memory: 10 },
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

    it('should throw when source exceeds 64KB for OJ', async () => {
      const body = {
        type: 'oj',
        source: 'x'.repeat(65537),
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when language is missing', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when timeLimitMs is out of range', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 999999,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when memoryLimitMb is out of range', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 10,
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

    it('should throw when testcase expectedOutput exceeds 10MB limit', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: 'x'.repeat(10 * 1024 * 1024 + 1) }],
        callback: { finish: 'http://finish' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when callback.finish is missing', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });
  });

  describe('URL validation', () => {
    it('should reject malformed callback URL in botzone task', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: 'code', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://update', finish: 'not-a-url' },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should reject non-http callback URL in botzone task', async () => {
      const body = {
        type: 'botzone',
        game: {
          judger: { language: 'cpp', source: 'code', limit: { time: 1000, memory: 256 } },
        },
        callback: { update: 'http://update', finish: 'ftp://evil.com/callback' },
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should reject malformed callback URL in OJ task', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'not-a-url' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });
  });

  describe('SSRF protection', () => {
    it.each([
      'http://127.0.0.1/callback',
      'http://localhost/callback',
      'http://10.0.0.1/callback',
      'http://172.16.0.1/callback',
      'http://192.168.1.1/callback',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/callback',
      'http://[::1]/callback',
      'http://[fe80::1]/callback',
      'http://[fd00::1]/callback',
      'http://[::ffff:192.168.1.1]/callback',
    ])('should reject private IP callback URL: %s', async (url) => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: url },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should reject IPs with invalid octets (>255)', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://172.16.999.999/callback' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should accept public IP callback URL', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://203.0.113.1/callback' },
        judgeMode: 'standard',
      };

      const result = await controller.submitTask(body);
      expect(result.jobId).toBe('job-456');
    });
  });

  describe('checker mode validation', () => {
    it('should accept checker mode with both checkerSource and checkerLanguage', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://example.com/callback' },
        judgeMode: 'checker',
        checkerSource: '#include "testlib.h"\nint main() {}',
        checkerLanguage: 'cpp',
      };

      const result = await controller.submitTask(body);
      expect(result.jobId).toBe('job-456');
    });

    it('should throw when checker mode is missing checkerSource', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://example.com/callback' },
        judgeMode: 'checker',
        checkerLanguage: 'cpp',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when checker mode is missing checkerLanguage', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://example.com/callback' },
        judgeMode: 'checker',
        checkerSource: '#include "testlib.h"\nint main() {}',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });

    it('should throw when checkerSource exceeds 64KB in checker mode', async () => {
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases: [{ id: 1, input: '1\n', expectedOutput: '1\n' }],
        callback: { finish: 'http://example.com/callback' },
        judgeMode: 'checker',
        checkerSource: 'x'.repeat(65537),
        checkerLanguage: 'cpp',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });
  });

  describe('testcase count limit', () => {
    it('should reject more than 1000 testcases', async () => {
      const testcases = Array.from({ length: 1001 }, (_, i) => ({
        id: i,
        input: '1\n',
        expectedOutput: '1\n',
      }));
      const body = {
        type: 'oj',
        source: 'int main() {}',
        language: 'cpp',
        timeLimitMs: 1000,
        memoryLimitMb: 256,
        testcases,
        callback: { finish: 'http://example.com/callback' },
        judgeMode: 'standard',
      };

      await expect(controller.submitTask(body)).rejects.toThrow(BadRequestException);
    });
  });
});
