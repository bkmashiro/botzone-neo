import {
  Verdict,
  CompileError,
  TimeLimitError,
  MemoryLimitError,
  RuntimeError,
  SandboxError,
  JudgeError,
} from './verdict';

describe('Verdict enum', () => {
  it('should have all expected values', () => {
    expect(Verdict.OK).toBe('OK');
    expect(Verdict.CE).toBe('CE');
    expect(Verdict.TLE).toBe('TLE');
    expect(Verdict.MLE).toBe('MLE');
    expect(Verdict.RE).toBe('RE');
    expect(Verdict.SE).toBe('SE');
    expect(Verdict.AC).toBe('AC');
    expect(Verdict.WA).toBe('WA');
  });
});

describe('JudgeError hierarchy', () => {
  it('CompileError should have verdict CE', () => {
    const err = new CompileError('syntax error', 'error at line 1');
    expect(err).toBeInstanceOf(JudgeError);
    expect(err).toBeInstanceOf(Error);
    expect(err.verdict).toBe(Verdict.CE);
    expect(err.message).toBe('syntax error');
    expect(err.compilerOutput).toBe('error at line 1');
    expect(err.name).toBe('CompileError');
  });

  it('TimeLimitError should have verdict TLE', () => {
    const err = new TimeLimitError(1000);
    expect(err.verdict).toBe(Verdict.TLE);
    expect(err.limitMs).toBe(1000);
    expect(err.message).toContain('1000');
  });

  it('MemoryLimitError should have verdict MLE', () => {
    const err = new MemoryLimitError(256);
    expect(err.verdict).toBe(Verdict.MLE);
    expect(err.limitMb).toBe(256);
  });

  it('RuntimeError should have verdict RE', () => {
    const err = new RuntimeError('segfault', 139);
    expect(err.verdict).toBe(Verdict.RE);
    expect(err.exitCode).toBe(139);
  });

  it('SandboxError should have verdict SE', () => {
    const err = new SandboxError('nsjail crash');
    expect(err.verdict).toBe(Verdict.SE);
  });
});
