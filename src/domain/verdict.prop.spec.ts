import * as fc from 'fast-check';
import { Verdict, CompileError } from './verdict';
import { RestartStrategy } from '../strategies/botzone/restart.strategy';
import { CompileService } from '../infrastructure/compile/compile.service';
import { ISandbox, SandboxResult } from '../infrastructure/sandbox/sandbox.interface';
import { ConfigService } from '@nestjs/config';

describe('Property-based tests', () => {
  describe('Verdict enum', () => {
    it('every Verdict value is a non-empty string', () => {
      for (const v of Object.values(Verdict)) {
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      }
    });

    it('arbitrary strings compared to Verdict values never throw', () => {
      fc.assert(
        fc.property(fc.string(), (s) => {
          const isVerdict = Object.values(Verdict).includes(s as Verdict);
          expect(typeof isVerdict).toBe('boolean');
        }),
      );
    });
  });

  describe('RestartStrategy.parseOutput', () => {
    let strategy: RestartStrategy;

    beforeEach(() => {
      const mockSandbox: ISandbox = {
        execute: jest.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          memoryKb: 0,
        } satisfies SandboxResult),
      };
      strategy = new RestartStrategy(mockSandbox);
    });

    it('never throws on arbitrary string input', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const result = strategy.parseOutput(input);
          expect(result).toBeDefined();
          expect(typeof result.response).toBe('string');
        }),
      );
    });

    it('always returns a valid BotOutput shape', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const result = strategy.parseOutput(input);
          expect(result).toHaveProperty('response');
          if (result.debug !== undefined) expect(typeof result.debug).toBe('string');
          if (result.data !== undefined) expect(typeof result.data).toBe('string');
          if (result.globaldata !== undefined) expect(typeof result.globaldata).toBe('string');
        }),
      );
    });

    it('handles arbitrary JSON objects without crashing', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (val) => {
          const input = JSON.stringify(val);
          const result = strategy.parseOutput(input);
          expect(result).toBeDefined();
          expect(typeof result.response).toBe('string');
        }),
      );
    });

    it('handles multi-line output with arbitrary lines', () => {
      fc.assert(
        fc.property(
          fc.array(fc.string({ minLength: 0, maxLength: 200 }), { minLength: 1, maxLength: 5 }),
          (lines) => {
            const input = lines.join('\n');
            const result = strategy.parseOutput(input);
            expect(result).toBeDefined();
            expect(typeof result.response).toBe('string');
          },
        ),
      );
    });
  });

  describe('CompileService.compile', () => {
    let service: CompileService;

    beforeEach(() => {
      const configService = {
        get: jest.fn((_key: string, defaultVal: unknown) => defaultVal),
      } as unknown as ConfigService;
      const mockCounter = { inc: jest.fn() };
      service = new CompileService(configService, mockCounter as never, mockCounter as never);
    });

    it('rejects unsupported languages gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string().filter((s) => !['cpp', 'python', 'typescript'].includes(s)),
          fc.string(),
          async (language, source) => {
            await expect(service.compile(language, source)).rejects.toThrow(CompileError);
          },
        ),
      );
    });

    it('getLanguage returns undefined for arbitrary non-supported language names', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !['cpp', 'python', 'typescript'].includes(s)),
          (name) => {
            expect(service.getLanguage(name)).toBeUndefined();
          },
        ),
      );
    });
  });
});
