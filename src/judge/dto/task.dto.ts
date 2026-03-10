import { IsObject, IsOptional, IsString, IsIn } from 'class-validator';

/**
 * 评测任务入参 DTO
 */

class LimitDto {
  time!: number;
  memory!: number;
}

class CodeDto {
  @IsString()
  language!: string;

  @IsString()
  source!: string;

  limit!: LimitDto;
}

class CallbackDto {
  @IsString()
  update!: string;

  @IsString()
  finish!: string;
}

export class TaskDto {
  /** 对局参与者代码映射 */
  @IsObject()
  game!: Record<string, CodeDto>;

  /** 回调地址 */
  @IsObject()
  callback!: CallbackDto;

  /** 初始化数据 */
  @IsOptional()
  initdata?: string | object;

  /** 运行模式 */
  @IsOptional()
  @IsIn(['restart', 'longrun'])
  runMode?: 'restart' | 'longrun';
}
