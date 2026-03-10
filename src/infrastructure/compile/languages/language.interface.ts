/**
 * 编程语言接口
 *
 * 定义编译和运行各语言代码所需的配置
 */
export interface ILanguage {
  /** 语言标识符 */
  readonly name: string;

  /** 文件扩展名 */
  readonly extension: string;

  /** 是否需要编译（解释型语言为 false） */
  readonly needsCompilation: boolean;

  /**
   * 获取编译命令
   * @param sourcePath 源代码文件路径
   * @param outputPath 编译输出路径（目录或文件，取决于语言）
   * @returns 编译命令和参数
   */
  getCompileCommand(sourcePath: string, outputPath: string): { cmd: string; args: string[] };

  /**
   * 获取运行命令
   * @param sourcePath 源文件路径
   * @param outputPath 编译输出路径
   * @returns 执行命令和参数（用于 spawn）
   */
  getRunCommand(sourcePath: string, outputPath: string): { cmd: string; args: string[] };

  /**
   * 获取沙箱中需要额外挂载的只读路径
   */
  getReadonlyMounts(): string[];
}
