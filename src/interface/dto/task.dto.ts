/**
 * 评测任务入参 DTO
 *
 * 支持两种任务类型：botzone（对局评测）和 oj（OJ 评测）
 */

import { IsString, IsOptional, IsIn, IsObject, IsArray, IsNumber } from 'class-validator';

// ── 公共 ──

class LimitDto {
  @IsNumber()
  time!: number;

  @IsNumber()
  memory!: number;
}

// ── Botzone ──

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

export class BotzoneTaskDto {
  @IsIn(['botzone'])
  type!: 'botzone';

  @IsObject()
  game!: Record<string, CodeDto>;

  callback!: CallbackDto;

  @IsOptional()
  initdata?: string | object;

  @IsOptional()
  @IsIn(['restart', 'longrun'])
  runMode?: 'restart' | 'longrun';
}

// ── OJ ──

class TestcaseDto {
  @IsNumber()
  id!: number;

  @IsString()
  input!: string;

  @IsString()
  expectedOutput!: string;

  @IsOptional()
  @IsNumber()
  timeLimitMs?: number;

  @IsOptional()
  @IsNumber()
  memoryLimitMb?: number;
}

export class OJTaskDto {
  @IsIn(['oj'])
  type!: 'oj';

  @IsString()
  language!: string;

  @IsString()
  source!: string;

  @IsArray()
  testcases!: TestcaseDto[];

  @IsNumber()
  timeLimitMs!: number;

  @IsNumber()
  memoryLimitMb!: number;

  callback!: { finish: string };

  @IsIn(['standard', 'checker'])
  judgeMode!: 'standard' | 'checker';

  @IsOptional()
  @IsString()
  checkerSource?: string;

  @IsOptional()
  @IsString()
  checkerLanguage?: string;
}

/** 统一入参：按 type 分发 */
export class TaskDto {
  @IsIn(['botzone', 'oj'])
  type!: 'botzone' | 'oj';

  // 其余字段透传给具体 DTO
  [key: string]: unknown;
}
