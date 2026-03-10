/**
 * 评测队列服务
 *
 * 基于 Bull 的并发控制：
 * - 队列名称: judge
 * - 并发数: JUDGE_CONCURRENCY 环境变量（默认 15）
 * - 已完成 job 保留: 最多 100 条
 * - 失败 job 保留: 最多 200 条
 * - Job TTL: 10 分钟（超时自动失败）
 */

import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue, Processor } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bull';
import { RunMatchUseCase } from '../application/run-match.usecase';
import { RunOJUseCase } from '../application/run-oj.usecase';
import { MatchTask } from '../domain/match';
import { OJTask } from '../domain/oj/testcase';

export const JUDGE_QUEUE = 'judge';

/** Job TTL: 10 分钟 */
const JOB_TTL_MS = 10 * 60 * 1000;

interface JudgeJobData {
  type: 'botzone' | 'oj';
  task: MatchTask | OJTask;
}

@Injectable()
@Processor(JUDGE_QUEUE)
export class JudgeQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JudgeQueueService.name);

  constructor(
    @InjectQueue(JUDGE_QUEUE) private readonly judgeQueue: Queue,
    private readonly runMatchUseCase: RunMatchUseCase,
    private readonly runOJUseCase: RunOJUseCase,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const concurrency = this.configService.get<number>('JUDGE_CONCURRENCY', 15);
    this.judgeQueue.process('run', concurrency, (job: Job<JudgeJobData>) => this.processTask(job));
    this.logger.log(`评测队列已启动，并发数: ${concurrency}`);
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`收到关闭信号 (${signal ?? 'unknown'})，等待进行中的任务完成...`);
    await this.judgeQueue.pause(true);

    // 给运行中的任务最多 30 秒完成
    const GRACE_MS = 30_000;
    const closePromise = this.judgeQueue.close().catch((err) => {
      this.logger.warn(`队列关闭异常: ${err}`);
    });
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        this.logger.warn('队列关闭超时，强制退出');
        resolve();
      }, GRACE_MS);
    });
    await Promise.race([closePromise, timeoutPromise]);

    this.logger.log('评测队列已关闭');
  }

  async enqueue(data: JudgeJobData): Promise<string> {
    const job = await this.judgeQueue.add('run', data, {
      removeOnComplete: 100,
      removeOnFail: 200,
      timeout: JOB_TTL_MS,
    });
    this.logger.log(`任务入队: jobId=${job.id}, type=${data.type}`);
    return String(job.id);
  }

  async getJobStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    type?: string;
    finishedOn?: string;
    failedReason?: string;
  } | null> {
    const job = await this.judgeQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      jobId: String(job.id),
      state,
      type: (job.data as JudgeJobData)?.type,
      ...(job.finishedOn ? { finishedOn: new Date(job.finishedOn).toISOString() } : {}),
      ...(job.failedReason ? { failedReason: job.failedReason } : {}),
    };
  }

  private async processTask(job: Job<JudgeJobData>): Promise<void> {
    const { type, task } = job.data;
    this.logger.log(`开始处理评测任务: jobId=${job.id}, type=${type}`);

    try {
      if (type === 'botzone') {
        await this.runMatchUseCase.execute(task as MatchTask);
      } else {
        await this.runOJUseCase.execute(task as OJTask);
      }
      this.logger.log(`评测任务完成: jobId=${job.id}`);
    } catch (err) {
      this.logger.error(`评测任务失败: jobId=${job.id}, error=${err}`);
      throw err;
    }
  }
}
