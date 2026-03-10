import { CompileStatus } from './bot';

describe('Bot domain', () => {
  describe('CompileStatus', () => {
    it('should have PENDING value', () => {
      expect(CompileStatus.PENDING).toBe('pending');
    });

    it('should have COMPILING value', () => {
      expect(CompileStatus.COMPILING).toBe('compiling');
    });

    it('should have SUCCESS value', () => {
      expect(CompileStatus.SUCCESS).toBe('success');
    });

    it('should have FAILED value', () => {
      expect(CompileStatus.FAILED).toBe('failed');
    });

    it('should have exactly 4 values', () => {
      const values = Object.values(CompileStatus);
      expect(values).toHaveLength(4);
      expect(values).toEqual(
        expect.arrayContaining(['pending', 'compiling', 'success', 'failed']),
      );
    });
  });
});
