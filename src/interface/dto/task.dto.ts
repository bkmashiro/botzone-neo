/**
 * 评测任务入参 DTO
 *
 * 支持两种任务类型：botzone（对局评测）和 oj（OJ 评测）
 *
 * 输入边界：
 * - source code: 最大 64KB
 * - time limit: 1ms ~ 30000ms
 * - memory limit: 16MB ~ 2048MB
 * - testcase input/expectedOutput: 最大 10MB（OJ 场景）
 */

import {
  IsString,
  IsOptional,
  IsIn,
  IsObject,
  IsArray,
  IsNumber,
  IsUrl,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 单个 source 最大长度（64KB） */
export const MAX_SOURCE_LENGTH = 65536;
/** 时间限制范围（毫秒） */
export const MIN_TIME_LIMIT_MS = 1;
export const MAX_TIME_LIMIT_MS = 30000;
/** 内存限制范围（MB） */
export const MIN_MEMORY_LIMIT_MB = 16;
export const MAX_MEMORY_LIMIT_MB = 2048;
/** 单个测试用例输入/输出最大长度（10MB） */
export const MAX_TESTCASE_LENGTH = 10 * 1024 * 1024;

// ── 公共 ──

class LimitDto {
  @ApiProperty({
    description: '时间限制（毫秒）',
    minimum: MIN_TIME_LIMIT_MS,
    maximum: MAX_TIME_LIMIT_MS,
    example: 1000,
  })
  @IsNumber()
  @Min(MIN_TIME_LIMIT_MS)
  @Max(MAX_TIME_LIMIT_MS)
  time!: number;

  @ApiProperty({
    description: '内存限制（MB）',
    minimum: MIN_MEMORY_LIMIT_MB,
    maximum: MAX_MEMORY_LIMIT_MB,
    example: 256,
  })
  @IsNumber()
  @Min(MIN_MEMORY_LIMIT_MB)
  @Max(MAX_MEMORY_LIMIT_MB)
  memory!: number;
}

// ── Botzone ──

class CodeDto {
  @ApiProperty({ description: '编程语言', example: 'cpp' })
  @IsString()
  language!: string;

  @ApiProperty({ description: '源代码', maxLength: MAX_SOURCE_LENGTH })
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  source!: string;

  @ApiProperty({ description: '资源限制', type: LimitDto })
  @ValidateNested()
  @Type(() => LimitDto)
  limit!: LimitDto;
}

class CallbackDto {
  @ApiProperty({ description: '每轮进度更新回调 URL', example: 'http://example.com/update' })
  @IsUrl({ require_tld: false })
  update!: string;

  @ApiProperty({ description: '对局结束回调 URL', example: 'http://example.com/finish' })
  @IsUrl({ require_tld: false })
  finish!: string;
}

export class BotzoneTaskDto {
  @ApiProperty({ description: '任务类型', enum: ['botzone'] })
  @IsIn(['botzone'])
  type!: 'botzone';

  @ApiProperty({
    description: '参与者代码，键为角色 ID（judger/0/1/...）',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/CodeDto' },
  })
  @IsObject()
  game!: Record<string, CodeDto>;

  @ApiProperty({ description: '回调地址', type: CallbackDto })
  @ValidateNested()
  @Type(() => CallbackDto)
  callback!: CallbackDto;

  @ApiPropertyOptional({ description: '对局初始化数据' })
  @IsOptional()
  initdata?: string | object;

  @ApiPropertyOptional({
    description: '运行模式',
    enum: ['restart', 'longrun'],
    default: 'restart',
  })
  @IsOptional()
  @IsIn(['restart', 'longrun'])
  runMode?: 'restart' | 'longrun';
}

// ── OJ ──

class TestcaseDto {
  @ApiProperty({ description: '用例编号', example: 1 })
  @IsNumber()
  id!: number;

  @ApiProperty({ description: '输入数据', example: '1 2\n' })
  @IsString()
  @MaxLength(MAX_TESTCASE_LENGTH)
  input!: string;

  @ApiProperty({ description: '期望输出', example: '3\n' })
  @IsString()
  @MaxLength(MAX_TESTCASE_LENGTH)
  expectedOutput!: string;

  @ApiPropertyOptional({ description: '本用例的时间限制（毫秒）' })
  @IsOptional()
  @IsNumber()
  @Min(MIN_TIME_LIMIT_MS)
  @Max(MAX_TIME_LIMIT_MS)
  timeLimitMs?: number;

  @ApiPropertyOptional({ description: '本用例的内存限制（MB）' })
  @IsOptional()
  @IsNumber()
  @Min(MIN_MEMORY_LIMIT_MB)
  @Max(MAX_MEMORY_LIMIT_MB)
  memoryLimitMb?: number;
}

export class OJTaskDto {
  @ApiProperty({ description: '任务类型', enum: ['oj'] })
  @IsIn(['oj'])
  type!: 'oj';

  @ApiProperty({ description: '编程语言', example: 'cpp' })
  @IsString()
  language!: string;

  @ApiProperty({ description: '源代码', maxLength: MAX_SOURCE_LENGTH })
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  source!: string;

  @ApiProperty({ description: '测试用例列表', type: [TestcaseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestcaseDto)
  testcases!: TestcaseDto[];

  @ApiProperty({
    description: '全局时间限制（毫秒）',
    minimum: MIN_TIME_LIMIT_MS,
    maximum: MAX_TIME_LIMIT_MS,
    example: 1000,
  })
  @IsNumber()
  @Min(MIN_TIME_LIMIT_MS)
  @Max(MAX_TIME_LIMIT_MS)
  timeLimitMs!: number;

  @ApiProperty({
    description: '全局内存限制（MB）',
    minimum: MIN_MEMORY_LIMIT_MB,
    maximum: MAX_MEMORY_LIMIT_MB,
    example: 256,
  })
  @IsNumber()
  @Min(MIN_MEMORY_LIMIT_MB)
  @Max(MAX_MEMORY_LIMIT_MB)
  memoryLimitMb!: number;

  @ApiProperty({ description: '结果回调地址' })
  callback!: { finish: string };

  @ApiProperty({ description: '判题模式', enum: ['standard', 'checker'] })
  @IsIn(['standard', 'checker'])
  judgeMode!: 'standard' | 'checker';

  @ApiPropertyOptional({ description: 'Special Judge 源代码' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  checkerSource?: string;

  @ApiPropertyOptional({ description: 'Special Judge 语言' })
  @IsOptional()
  @IsString()
  checkerLanguage?: string;
}

/** 统一入参：按 type 分发 */
export class TaskDto {
  @ApiProperty({ description: '任务类型', enum: ['botzone', 'oj'] })
  @IsIn(['botzone', 'oj'])
  type!: 'botzone' | 'oj';

  // 其余字段透传给具体 DTO
  [key: string]: unknown;
}
