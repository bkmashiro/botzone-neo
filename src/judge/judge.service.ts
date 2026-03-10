import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { ConfigService } from '@nestjs/config';
import { TaskDto } from './dto/task.dto';
import { MatchRunner } from './match-runner';

/** 评测队列名称 */
export const JUDGE_QUEUE = 'judge';

/**
 * 评测服务：接收任务、入队、消费队列
 */
@Injectable()
@Processor(JUDGE_QUEUE)
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);

  constructor(
    @InjectQueue(JUDGE_QUEUE) private readonly judgeQueue: Queue,
    private readonly matchRunner: MatchRunner,
    private readonly configService: ConfigService,
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

  /** 获取信任 IP 列表 */
  getTrustIps(): string[] {
    const trustIp = this.configService.get<string>('TRUST_IP', '127.0.0.1');
    return trustIp.split(',').map((ip) => ip.trim());
  }

  /** 获取并发能力 */
  getConcurrency(): number {
    return this.configService.get<number>('JUDGE_CAPABILITY', 15);
  }

  /** Bull 队列处理器：消费评测任务 */
  @Process({ name: 'run', concurrency: 15 })
  async processTask(job: Job<TaskDto>): Promise<void> {
    this.logger.log(`开始处理评测任务: jobId=${job.id}`);
    try {
      await this.matchRunner.run(job.data);
    } catch (err) {
      this.logger.error(`评测任务失败: jobId=${job.id}, error=${err}`);
      throw err;
    }
  }
}
