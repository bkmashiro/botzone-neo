import { DiffChecker } from './diff.checker';
import { Verdict } from '../../domain/verdict';

describe('DiffChecker', () => {
  const checker = new DiffChecker();

  it('完全匹配 → AC', async () => {
    const result = await checker.check('', 'hello\nworld\n', 'hello\nworld\n');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('忽略末尾空行 → AC', async () => {
    const result = await checker.check('', 'hello\nworld', 'hello\nworld\n\n');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('忽略行末空白 → AC', async () => {
    const result = await checker.check('', 'hello\nworld\n', 'hello  \nworld\t\n');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('内容不同 → WA', async () => {
    const result = await checker.check('', 'hello\n', 'world\n');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('第 1 行');
  });

  it('行数不同 → WA', async () => {
    const result = await checker.check('', 'a\n', 'a\nb\n');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('行数不匹配');
  });

  it('空输出匹配空答案 → AC', async () => {
    const result = await checker.check('', '', '');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('空输出 vs 非空答案 → WA', async () => {
    const result = await checker.check('', 'expected\n', '');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('行数不匹配');
  });

  it('非空输出 vs 空答案 → WA', async () => {
    const result = await checker.check('', '', 'unexpected\n');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('行数不匹配');
  });

  it('纯空白输出匹配空答案 → AC', async () => {
    const result = await checker.check('', '', '   \n\n  \n');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('多行匹配只有中间行不同 → WA 并报正确行号', async () => {
    const result = await checker.check('', 'a\nb\nc\n', 'a\nX\nc\n');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('第 2 行');
  });

  it('input 参数不影响比较结果', async () => {
    const result = await checker.check('some input data', 'hello', 'hello');
    expect(result.verdict).toBe(Verdict.AC);
  });
});
