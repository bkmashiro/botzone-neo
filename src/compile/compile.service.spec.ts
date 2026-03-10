import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CompileService } from './compile.service';
import * as child_process from 'child_process';
import * as fs from 'fs/promises';
import { EventEmitter } from 'events';
import { Writable } from 'stream';

// Mock child_process.spawn
jest.mock('child_process');
jest.mock('fs/promises');

/** 创建一个假的 ChildProcess */
function createFakeChild(
  exitCode: number,
  stdout = '',
  stderr = '',
  delay = 0,
) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  child.kill = jest.fn();

  setTimeout(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', exitCode);
  }, delay);

  return child;
}

describe('CompileService', () => {
  let service: CompileService;
  const mockSpawn = child_process.spawn as jest.MockedFunction<typeof child_process.spawn>;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock fs 操作
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.access as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompileService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal: unknown) => {
              if (key === 'COMPILE_TIME_LIMIT_MS') return 5000;
              return defaultVal;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CompileService>(CompileService);
  });

  describe('LRU 缓存', () => {
    it('应该在首次编译时缓存未命中并执行编译', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      const result = await service.compile('cpp', 'int main() {}');

      expect(result.verdict).toBe('OK');
      expect(result.execCmd).toBeDefined();
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('应该在相同代码二次编译时命中缓存', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      // 首次编译
      await service.compile('cpp', 'int main() { return 0; }');
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      // 二次编译应命中缓存
      const result = await service.compile('cpp', 'int main() { return 0; }');
      expect(result.verdict).toBe('OK');
      // spawn 不应被再次调用
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('应该在缓存文件不存在时重新编译', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      // 首次编译
      await service.compile('cpp', 'int main() { return 1; }');

      // 模拟缓存文件被删除
      (fs.access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      const result = await service.compile('cpp', 'int main() { return 1; }');
      expect(result.verdict).toBe('OK');
      // 应该重新编译（spawn 被调用两次）
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('编译命令生成', () => {
    it('应该为 C++ 生成正确的编译命令（g++ -O2 -std=c++17）', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      await service.compile('cpp', '#include <iostream>\nint main() {}');

      const [cmd, args] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('g++');
      expect(args).toContain('-O2');
      expect(args).toContain('-std=c++17');
      expect(args).toContain('-DONLINE_JUDGE');
    });

    it('应该为 Python 生成语法检查命令（python3 -m py_compile）', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      await service.compile('python', 'print("hello")');

      const [cmd, args] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('python3');
      expect(args).toContain('-m');
      expect(args).toContain('py_compile');
    });

    it('应该为 TypeScript 生成编译命令（tsc --strict）', async () => {
      mockSpawn.mockReturnValue(createFakeChild(0) as any);

      await service.compile('typescript', 'const x: number = 1;');

      const [cmd, args] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('tsc');
      expect(args).toContain('--strict');
      expect(args).toContain('--target');
      expect(args).toContain('ES2021');
    });
  });

  describe('编译失败处理', () => {
    it('应该在编译失败时返回 CE verdict', async () => {
      mockSpawn.mockReturnValue(
        createFakeChild(1, '', 'error: expected ;') as any,
      );

      const result = await service.compile('cpp', 'invalid code');

      expect(result.verdict).toBe('CE');
      expect(result.message).toContain('expected ;');
    });

    it('应该在不支持的语言时返回 CE verdict', async () => {
      const result = await service.compile('rust', 'fn main() {}');

      expect(result.verdict).toBe('CE');
      expect(result.message).toContain('不支持的语言');
    });

    it('应该在编译输出为空时返回默认错误信息', async () => {
      mockSpawn.mockReturnValue(createFakeChild(1, '', '') as any);

      const result = await service.compile('cpp', 'bad');

      expect(result.verdict).toBe('CE');
      expect(result.message).toBe('编译失败');
    });
  });

  describe('语言配置', () => {
    it('应该正确注册三种语言', () => {
      expect(service.getLanguage('cpp')).toBeDefined();
      expect(service.getLanguage('python')).toBeDefined();
      expect(service.getLanguage('typescript')).toBeDefined();
    });

    it('应该为不存在的语言返回 undefined', () => {
      expect(service.getLanguage('java')).toBeUndefined();
    });
  });
});
