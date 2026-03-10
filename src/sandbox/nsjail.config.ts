/**
 * nsjail 配置构建器
 *
 * 根据语言和资源限制生成 nsjail 命令行参数
 */
export interface NsjailOptions {
  /** 可执行文件路径（命令） */
  execPath: string;
  /** 执行参数 */
  execArgs?: string[];
  /** 工作目录（沙箱内可写） */
  workDir: string;
  /** 时间限制（秒） */
  timeLimit: number;
  /** 内存限制（MB） */
  memoryLimit: number;
  /** 额外挂载的只读路径 */
  readonlyMounts?: string[];
}

/**
 * 构建 nsjail 命令行参数
 */
export function buildNsjailArgs(opts: NsjailOptions): string[] {
  const args: string[] = [
    '--mode', 'o',                        // 一次性模式
    '--time_limit', String(opts.timeLimit),
    '--rlimit_as', String(opts.memoryLimit),
    '--rlimit_cpu', String(opts.timeLimit),
    '--rlimit_fsize', '64',              // 输出文件大小限制（MB）
    '--rlimit_nofile', '64',             // 文件描述符数量限制

    // 基础只读挂载
    '--mount', '/bin:/bin:ro',
    '--mount', '/lib:/lib:ro',
    '--mount', '/lib64:/lib64:ro',
    '--mount', '/usr:/usr:ro',

    // 工作目录（可写）
    '--mount', `${opts.workDir}:/workspace:rw`,
    '--cwd', '/workspace',

    // 网络隔离
    '--disable_clone_newnet',

    // 用户映射
    '--uid_mapping', '0:65534:1',
    '--gid_mapping', '0:65534:1',
  ];

  // 额外只读挂载
  if (opts.readonlyMounts) {
    for (const mount of opts.readonlyMounts) {
      args.push('--mount', `${mount}:${mount}:ro`);
    }
  }

  // 被执行的命令及参数
  args.push('--', opts.execPath);
  if (opts.execArgs) {
    args.push(...opts.execArgs);
  }

  return args;
}
