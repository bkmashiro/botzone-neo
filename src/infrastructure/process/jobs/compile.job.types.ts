/**
 * CompileJob 的输出类型
 *
 * 独立文件，方便其他模块引用而不依赖整个 compile.job。
 */

/** 编译产物：描述如何运行一个已编译的程序 */
export interface CompiledArtifact {
  /** 执行命令（如 /path/to/binary 或 python3） */
  cmd: string;
  /** 执行参数（如 [] 或 ['/path/to/source.py']） */
  args: string[];
  /** 编程语言标识 */
  language: string;
  /** 沙箱中需要额外挂载的只读路径 */
  readonlyMounts: string[];
  /** 编译产物所在目录 */
  workDir: string;
}
