import { createStrategy, JudgerSpec } from './strategy.factory';
import { UserJudgeStrategy } from './user-judge.strategy';
import { CompileService } from '../../infrastructure/compile/compile.service';
import { CompiledBot } from '../../domain/bot';

const compiledBot: CompiledBot = {
  cmd: 'python3',
  args: ['/cache/abc/judge.py'],
  language: 'python',
  readonlyMounts: [],
};

// We mock the entire judge-program.runner module so JudgeProgramRunner
// is never actually constructed (avoids spawning real processes).
jest.mock('../../infrastructure/judge-runner/judge-program.runner', () => {
  return {
    JudgeProgramRunner: jest.fn().mockImplementation(() => ({
      runRound: jest.fn(),
      cleanup: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

function makeCompileService(result: CompiledBot | Error): jest.Mocked<CompileService> {
  const svc = {
    compile: jest.fn(),
  } as unknown as jest.Mocked<CompileService>;

  if (result instanceof Error) {
    svc.compile.mockRejectedValue(result);
  } else {
    svc.compile.mockResolvedValue(result);
  }

  return svc;
}

describe('StrategyFactory – createStrategy', () => {
  const workDir = '/tmp/match-work';

  describe('user-submitted judge (source provided)', () => {
    it('returns a UserJudgeStrategy when source is a non-empty string', async () => {
      const spec: JudgerSpec = { source: 'print("hello")', language: 'python' };
      const svc = makeCompileService(compiledBot);

      const strategy = await createStrategy(spec, svc, workDir);

      expect(strategy).toBeInstanceOf(UserJudgeStrategy);
      expect(svc.compile).toHaveBeenCalledWith('python', 'print("hello")');
    });

    it('defaults to python when language is omitted', async () => {
      const spec: JudgerSpec = { source: 'pass' };
      const svc = makeCompileService(compiledBot);

      await createStrategy(spec, svc, workDir);

      expect(svc.compile).toHaveBeenCalledWith('python', 'pass');
    });

    it('uses the provided language when given', async () => {
      const spec: JudgerSpec = { source: '#include<stdio.h>', language: 'cpp' };
      const svc = makeCompileService(compiledBot);

      await createStrategy(spec, svc, workDir);

      expect(svc.compile).toHaveBeenCalledWith('cpp', '#include<stdio.h>');
    });

    it('propagates CompileError from the compile service', async () => {
      const spec: JudgerSpec = { source: 'bad code', language: 'cpp' };
      const svc = makeCompileService(new Error('syntax error'));

      await expect(createStrategy(spec, svc, workDir)).rejects.toThrow('syntax error');
    });

    it('treats a source that is only whitespace as absent', async () => {
      const spec: JudgerSpec = { source: '   ', language: 'python' };
      const svc = makeCompileService(compiledBot);

      // Whitespace-only source → falls through to name check → no name → throws
      await expect(createStrategy(spec, svc, workDir)).rejects.toThrow(/Invalid judger spec/);
      expect(svc.compile).not.toHaveBeenCalled();
    });
  });

  describe('built-in strategy by name', () => {
    it('throws an informative error when name is provided (not yet in DB)', async () => {
      const spec: JudgerSpec = { name: 'tictactoe' };
      const svc = makeCompileService(compiledBot);

      await expect(createStrategy(spec, svc, workDir)).rejects.toThrow(/tictactoe/);
      expect(svc.compile).not.toHaveBeenCalled();
    });
  });

  describe('invalid spec', () => {
    it('throws when neither source nor name is provided', async () => {
      const spec: JudgerSpec = {};
      const svc = makeCompileService(compiledBot);

      await expect(createStrategy(spec, svc, workDir)).rejects.toThrow(/Invalid judger spec/);
    });

    it('throws when source is empty string', async () => {
      const spec: JudgerSpec = { source: '', language: 'python' };
      const svc = makeCompileService(compiledBot);

      await expect(createStrategy(spec, svc, workDir)).rejects.toThrow(/Invalid judger spec/);
    });
  });
});
