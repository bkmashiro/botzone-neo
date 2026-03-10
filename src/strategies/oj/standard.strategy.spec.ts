import { StandardStrategy } from './standard.strategy';
import { Verdict } from '../../domain/verdict';

describe('StandardStrategy', () => {
  const strategy = new StandardStrategy();

  it('完全匹配 → AC', () => {
    const result = strategy.judge('hello\nworld\n', 'hello\nworld\n');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('忽略末尾空行 → AC', () => {
    const result = strategy.judge('hello\nworld\n\n', 'hello\nworld');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('忽略行末空白 → AC', () => {
    const result = strategy.judge('hello  \nworld\t\n', 'hello\nworld\n');
    expect(result.verdict).toBe(Verdict.AC);
  });

  it('内容不同 → WA', () => {
    const result = strategy.judge('hello\n', 'world\n');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('第 1 行');
  });

  it('行数不同 → WA', () => {
    const result = strategy.judge('a\nb\n', 'a\n');
    expect(result.verdict).toBe(Verdict.WA);
    expect(result.message).toContain('行数不匹配');
  });

  it('空输出匹配空答案 → AC', () => {
    const result = strategy.judge('', '');
    expect(result.verdict).toBe(Verdict.AC);
  });
});
