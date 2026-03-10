import {
  Verdict,
  CompileError,
  TimeLimitError,
  MemoryLimitError,
  RuntimeError,
  JudgeFormatError,
  SandboxError,
  JudgeError,
} from './verdict';

describe('Verdict 枚举', () => {
  it('包含所有预期的值', () => {
    expect(Verdict.OK).toBe('OK');
    expect(Verdict.CE).toBe('CE');
    expect(Verdict.TLE).toBe('TLE');
    expect(Verdict.MLE).toBe('MLE');
    expect(Verdict.RE).toBe('RE');
    expect(Verdict.SE).toBe('SE');
    expect(Verdict.NR).toBe('NR');
    expect(Verdict.NJ).toBe('NJ');
    expect(Verdict.WA).toBe('WA');
    expect(Verdict.AC).toBe('AC');
  });
});

describe('错误类', () => {
  it('CompileError', () => {
    const err = new CompileError('语法错误', 'main.cpp:1:1 error');
    expect(err).toBeInstanceOf(JudgeError);
    expect(err).toBeInstanceOf(Error);
    expect(err.verdict).toBe(Verdict.CE);
    expect(err.message).toBe('语法错误');
    expect(err.compilerOutput).toBe('main.cpp:1:1 error');
    expect(err.name).toBe('CompileError');
  });

  it('TimeLimitError', () => {
    const err = new TimeLimitError(1000);
    expect(err.verdict).toBe(Verdict.TLE);
    expect(err.limitMs).toBe(1000);
    expect(err.message).toContain('1000ms');
  });

  it('MemoryLimitError', () => {
    const err = new MemoryLimitError(256);
    expect(err.verdict).toBe(Verdict.MLE);
    expect(err.limitMb).toBe(256);
    expect(err.message).toContain('256MB');
  });

  it('RuntimeError', () => {
    const err = new RuntimeError('段错误', 139);
    expect(err.verdict).toBe(Verdict.RE);
    expect(err.exitCode).toBe(139);
  });

  it('JudgeFormatError', () => {
    const err = new JudgeFormatError('裁判输出格式不正确');
    expect(err.verdict).toBe(Verdict.NJ);
  });

  it('SandboxError', () => {
    const err = new SandboxError('nsjail 启动失败');
    expect(err.verdict).toBe(Verdict.SE);
  });
});
