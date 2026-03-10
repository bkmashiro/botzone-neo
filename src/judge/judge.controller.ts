import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { JudgeService } from './judge.service';
import { TaskDto } from './dto/task.dto';

/**
 * 评测接口控制器
 */
@Controller('v1/judge')
export class JudgeController {
  constructor(private readonly judgeService: JudgeService) {}

  /** 提交评测任务 */
  @Post()
  @HttpCode(202)
  async submitTask(@Body() taskDto: TaskDto) {
    const jobId = await this.judgeService.enqueue(taskDto);
    return { jobId, message: '评测任务已入队' };
  }
}
