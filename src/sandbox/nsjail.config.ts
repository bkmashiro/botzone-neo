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

/** 安全上限 */
const MAX_TIME_LIMIT_SEC = 300;
const MAX_MEMORY_LIMIT_MB = 4096;

/** 将数值钳制到安全范围内，防止 Infinity/NaN/负数 */
function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min) return min;
  return Math.min(value, max);
}

/**
 * 构建 nsjail 命令行参数
 */
export function buildNsjailArgs(opts: NsjailOptions): string[] {
  const timeLimit = clampLimit(opts.timeLimit, 1, MAX_TIME_LIMIT_SEC);
  const memoryLimit = clampLimit(opts.memoryLimit, 16, MAX_MEMORY_LIMIT_MB);

  const args: string[] = [
    '--mode',
    'o', // 一次性模式
    '--time_limit',
    String(timeLimit),
    '--rlimit_as',
    String(memoryLimit),
    '--rlimit_cpu',
    String(timeLimit),
    '--rlimit_fsize',
    '64', // 输出文件大小限制（MB）
    '--rlimit_nofile',
    '64', // 文件描述符数量限制

    // 基础只读挂载
    '--mount',
    '/bin:/bin:ro',
    '--mount',
    '/lib:/lib:ro',
    '--mount',
    '/lib64:/lib64:ro',
    '--mount',
    '/usr:/usr:ro',

    // 工作目录（可写）
    '--mount',
    `${opts.workDir}:/workspace:rw`,
    '--cwd',
    '/workspace',

    // 网络隔离
    '--disable_clone_newnet',

    // 用户映射
    '--uid_mapping',
    '0:65534:1',
    '--gid_mapping',
    '0:65534:1',
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
