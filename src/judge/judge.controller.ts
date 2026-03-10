import {
  Controller,
  Post,
  Body,
  HttpCode,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { JudgeService } from './judge.service';
import { TaskDto } from './dto/task.dto';

/**
 * 评测接口控制器
 */
@Controller('v1/judge')
export class JudgeController {
  constructor(private readonly judgeService: JudgeService) {}

  /** 提交评测任务（验证来源 IP） */
  @Post()
  @HttpCode(202)
  async submitTask(@Body() taskDto: TaskDto, @Req() req: Request) {
    // 验证来源 IP
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      '';
    const trustIps = this.judgeService.getTrustIps();
    if (!trustIps.includes(clientIp) && !trustIps.includes('0.0.0.0')) {
      throw new ForbiddenException(`不信任的来源 IP: ${clientIp}`);
    }

    const jobId = await this.judgeService.enqueue(taskDto);
    return { jobId, message: '评测任务已入队' };
  }
}
