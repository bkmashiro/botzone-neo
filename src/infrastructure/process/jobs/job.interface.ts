/**
 * IJob<TIn, TOut> — 可组合的工作单元接口
 *
 * 所有 Job（编译、运行、装饰器）都实现此接口，
 * 通过组合实现 jailed(metered(run(compiled))) 的管道。
 */
export interface IJob<TIn, TOut> {
  execute(input: TIn): Promise<TOut>;
}
