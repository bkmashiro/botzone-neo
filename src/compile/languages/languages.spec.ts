import { CppLanguage } from './cpp.language';
import { PythonLanguage } from './python.language';
import { TypeScriptLanguage } from './typescript.language';

describe('Language configurations', () => {
  describe('CppLanguage', () => {
    const lang = new CppLanguage();

    it('should have correct name and extension', () => {
      expect(lang.name).toBe('cpp');
      expect(lang.extension).toBe('.cpp');
    });

    it('should return readonly mounts', () => {
      expect(lang.getReadonlyMounts()).toContain('/usr/local/include');
    });

    it('should return correct run command', () => {
      const { cmd, args } = lang.getRunCommand('/src/main.cpp', '/out/main');
      expect(cmd).toBe('/out/main');
      expect(args).toEqual([]);
    });
  });

  describe('PythonLanguage', () => {
    const lang = new PythonLanguage();

    it('should have correct name and extension', () => {
      expect(lang.name).toBe('python');
      expect(lang.extension).toBe('.py');
    });

    it('should return readonly mounts', () => {
      expect(lang.getReadonlyMounts()).toContain('/usr/lib/python3');
    });

    it('should return correct run command', () => {
      const { cmd, args } = lang.getRunCommand('/src/main.py', '/out/main');
      expect(cmd).toBe('python3');
      expect(args).toEqual(['/src/main.py']);
    });
  });

  describe('TypeScriptLanguage', () => {
    const lang = new TypeScriptLanguage();

    it('should have correct name and extension', () => {
      expect(lang.name).toBe('typescript');
      expect(lang.extension).toBe('.ts');
    });

    it('should return readonly mounts', () => {
      expect(lang.getReadonlyMounts()).toContain('/usr/local/lib/node_modules');
    });

    it('should return correct run command', () => {
      const { cmd, args } = lang.getRunCommand('/src/main.ts', '/out');
      expect(cmd).toBe('node');
      expect(args).toEqual(['/out/main.js']);
    });
  });
});
