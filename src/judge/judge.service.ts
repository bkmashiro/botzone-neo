import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { TaskDto } from './dto/task.dto';
import { MatchRunner } from './match-runner';

/** 评测队列名称 */
export const JUDGE_QUEUE = 'judge';

/**
 * 评测服务：接收任务、入队、消费队列
 */
@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    @InjectQueue(JUDGE_QUEUE) private readonly judgeQueue: Queue,
    private readonly matchRunner: MatchRunner,
  ) {}

  /** 将评测任务加入队列 */
  async enqueue(task: TaskDto): Promise<string> {
    const job = await this.judgeQueue.add('run', task, {
      removeOnComplete: 100,
      removeOnFail: 200,
    });
    this.logger.log(`任务入队: jobId=${job.id}`);
    return String(job.id);
  }

  /** 处理评测任务（由 Bull processor 调用） */
  async processTask(task: TaskDto): Promise<void> {
    this.logger.log('开始处理评测任务');
    await this.matchRunner.run(task);
  }
}
