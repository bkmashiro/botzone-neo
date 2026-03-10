import { buildNsjailArgs, NsjailOptions } from './nsjail.config';

describe('buildNsjailArgs', () => {
  const baseOpts: NsjailOptions = {
    execPath: '/usr/bin/python3',
    workDir: '/tmp/sandbox-123',
    timeLimit: 5,
    memoryLimit: 256,
  };

  it('should include mode, time_limit, rlimit_as, and rlimit_cpu', () => {
    const args = buildNsjailArgs(baseOpts);
    expect(args).toContain('--mode');
    expect(args[args.indexOf('--mode') + 1]).toBe('o');
    expect(args[args.indexOf('--time_limit') + 1]).toBe('5');
    expect(args[args.indexOf('--rlimit_as') + 1]).toBe('256');
    expect(args[args.indexOf('--rlimit_cpu') + 1]).toBe('5');
  });

  it('should include rlimit_fsize and rlimit_nofile', () => {
    const args = buildNsjailArgs(baseOpts);
    expect(args[args.indexOf('--rlimit_fsize') + 1]).toBe('64');
    expect(args[args.indexOf('--rlimit_nofile') + 1]).toBe('64');
  });

  it('should include base readonly mounts for /bin, /lib, /lib64, /usr', () => {
    const args = buildNsjailArgs(baseOpts);
    expect(args).toContain('/bin:/bin:ro');
    expect(args).toContain('/lib:/lib:ro');
    expect(args).toContain('/lib64:/lib64:ro');
    expect(args).toContain('/usr:/usr:ro');
  });

  it('should mount workDir as rw at /workspace', () => {
    const args = buildNsjailArgs(baseOpts);
    expect(args).toContain('/tmp/sandbox-123:/workspace:rw');
    expect(args).toContain('--cwd');
    expect(args[args.indexOf('--cwd') + 1]).toBe('/workspace');
  });

  it('should include network isolation flag', () => {
    const args = buildNsjailArgs(baseOpts);
    expect(args).toContain('--disable_clone_newnet');
  });

  it('should include user/group mapping', () => {
    const args = buildNsjailArgs(baseOpts);
    expect(args[args.indexOf('--uid_mapping') + 1]).toBe('0:65534:1');
    expect(args[args.indexOf('--gid_mapping') + 1]).toBe('0:65534:1');
  });

  it('should add extra readonly mounts when provided', () => {
    const args = buildNsjailArgs({
      ...baseOpts,
      readonlyMounts: ['/opt/python3', '/opt/node'],
    });
    expect(args).toContain('/opt/python3:/opt/python3:ro');
    expect(args).toContain('/opt/node:/opt/node:ro');
  });

  it('should not add extra mounts when readonlyMounts is undefined', () => {
    const args = buildNsjailArgs(baseOpts);
    // Count number of --mount entries: 4 base + 1 workDir = 5
    const mountCount = args.filter((a, i) => a === '--mount' && i > 0).length;
    // base readonly: /bin, /lib, /lib64, /usr (4) + workDir (1) = 5
    expect(mountCount).toBe(5);
  });

  it('should place execPath after -- separator', () => {
    const args = buildNsjailArgs(baseOpts);
    const sepIndex = args.indexOf('--');
    expect(sepIndex).toBeGreaterThan(0);
    expect(args[sepIndex + 1]).toBe('/usr/bin/python3');
  });

  it('should append execArgs after execPath', () => {
    const args = buildNsjailArgs({
      ...baseOpts,
      execArgs: ['/workspace/main.py', '--verbose'],
    });
    const sepIndex = args.indexOf('--');
    expect(args[sepIndex + 1]).toBe('/usr/bin/python3');
    expect(args[sepIndex + 2]).toBe('/workspace/main.py');
    expect(args[sepIndex + 3]).toBe('--verbose');
  });

  it('should not append args when execArgs is undefined', () => {
    const args = buildNsjailArgs(baseOpts);
    const sepIndex = args.indexOf('--');
    // Only execPath after --
    expect(args.length).toBe(sepIndex + 2);
  });
});
