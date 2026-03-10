import {
  MAX_SOURCE_LENGTH,
  MIN_TIME_LIMIT_MS,
  MAX_TIME_LIMIT_MS,
  MIN_MEMORY_LIMIT_MB,
  MAX_MEMORY_LIMIT_MB,
  MAX_TESTCASE_LENGTH,
  BotzoneTaskDto,
  OJTaskDto,
  TaskDto,
} from './task.dto';

describe('task.dto constants', () => {
  it('should define expected boundary values', () => {
    expect(MAX_SOURCE_LENGTH).toBe(65536);
    expect(MIN_TIME_LIMIT_MS).toBe(1);
    expect(MAX_TIME_LIMIT_MS).toBe(30000);
    expect(MIN_MEMORY_LIMIT_MB).toBe(16);
    expect(MAX_MEMORY_LIMIT_MB).toBe(2048);
    expect(MAX_TESTCASE_LENGTH).toBe(10 * 1024 * 1024);
  });
});

describe('DTO classes', () => {
  it('should instantiate BotzoneTaskDto', () => {
    const dto = new BotzoneTaskDto();
    dto.type = 'botzone';
    expect(dto.type).toBe('botzone');
  });

  it('should instantiate OJTaskDto', () => {
    const dto = new OJTaskDto();
    dto.type = 'oj';
    dto.language = 'cpp';
    expect(dto.type).toBe('oj');
  });

  it('should instantiate TaskDto', () => {
    const dto = new TaskDto();
    dto.type = 'botzone';
    expect(dto.type).toBe('botzone');
  });
});
