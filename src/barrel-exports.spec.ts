/**
 * 导入所有 barrel export 文件以确保覆盖率统计
 */

import * as domain from './domain';
import * as domainOj from './domain/oj';
import * as infraCompile from './infrastructure/compile';
import * as infraSandbox from './infrastructure/sandbox';
import * as strategies from './strategies';
import * as strategiesOj from './strategies/oj';

describe('barrel exports', () => {
  it('domain exports expected symbols', () => {
    expect(domain.Verdict).toBeDefined();
    expect(domain.Match).toBeDefined();
    expect(domain.CompileError).toBeDefined();
  });

  it('domain/oj exports expected symbols', () => {
    expect(domainOj).toBeDefined();
  });

  it('infrastructure/compile exports CompileService', () => {
    expect(infraCompile.CompileService).toBeDefined();
  });

  it('infrastructure/sandbox exports sandbox types', () => {
    expect(infraSandbox.SANDBOX_TOKEN).toBeDefined();
    expect(infraSandbox.NsjailSandbox).toBeDefined();
    expect(infraSandbox.DirectSandbox).toBeDefined();
  });

  it('strategies exports expected symbols', () => {
    expect(strategies.RestartStrategy).toBeDefined();
    expect(strategies.LongrunStrategy).toBeDefined();
  });

  it('strategies/oj exports checkers', () => {
    expect(strategiesOj.DiffChecker).toBeDefined();
    expect(strategiesOj.CustomChecker).toBeDefined();
  });
});
