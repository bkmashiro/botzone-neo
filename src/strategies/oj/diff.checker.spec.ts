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
});
