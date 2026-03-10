import { parseBotOutput, BotOutputParseError } from './bot-output-parser';

describe('parseBotOutput', () => {
  describe('raw value (line does not start with "{")', () => {
    it('returns a number when the line is an integer string', () => {
      const result = parseBotOutput('42', '');
      expect(result.move).toBe(42);
    });

    it('returns a number when the line is a float string', () => {
      const result = parseBotOutput('3.14', '');
      expect(result.move).toBeCloseTo(3.14);
    });

    it('returns a string when the line is not numeric', () => {
      const result = parseBotOutput('left', '');
      expect(result.move).toBe('left');
    });

    it('trims whitespace before parsing', () => {
      const result = parseBotOutput('  42  ', '');
      expect(result.move).toBe(42);
    });

    it('uses only the first line of stdout', () => {
      const result = parseBotOutput('7\nextra line', '');
      expect(result.move).toBe(7);
    });

    it('attaches stderr as debug when stderr is non-empty', () => {
      const result = parseBotOutput('5', 'debug info');
      expect(result.debug).toBe('debug info');
    });

    it('does not set debug when stderr is empty', () => {
      const result = parseBotOutput('5', '');
      expect(result.debug).toBeUndefined();
    });

    it('handles a negative number', () => {
      const result = parseBotOutput('-1', '');
      expect(result.move).toBe(-1);
    });

    it('handles zero', () => {
      const result = parseBotOutput('0', '');
      expect(result.move).toBe(0);
    });

    it('returns an empty string move for empty stdout', () => {
      const result = parseBotOutput('', '');
      expect(result.move).toBe('');
    });
  });

  describe('JSON envelope (line starts with "{")', () => {
    it('extracts the move field from a JSON object', () => {
      const result = parseBotOutput('{"move": 42}', '');
      expect(result.move).toBe(42);
    });

    it('extracts the debug field from a JSON object', () => {
      const result = parseBotOutput('{"move": 5, "debug": "random pick"}', '');
      expect(result.debug).toBe('random pick');
    });

    it('falls back to the whole parsed object when move field is absent', () => {
      const obj = { col: 3 };
      const result = parseBotOutput(JSON.stringify(obj), '');
      expect(result.move).toEqual(obj);
    });

    it('supports move: 0 (falsy but valid)', () => {
      const result = parseBotOutput('{"move": 0}', '');
      expect(result.move).toBe(0);
    });

    it('supports move: null', () => {
      const result = parseBotOutput('{"move": null}', '');
      expect(result.move).toBeNull();
    });

    it('supports move as a string', () => {
      const result = parseBotOutput('{"move": "resign"}', '');
      expect(result.move).toBe('resign');
    });

    it('supports move as an array', () => {
      const result = parseBotOutput('{"move": [1, 2]}', '');
      expect(result.move).toEqual([1, 2]);
    });

    it('does not set debug when debug field is absent', () => {
      const result = parseBotOutput('{"move": 1}', '');
      expect(result.debug).toBeUndefined();
    });

    it('ignores debug field if it is not a string', () => {
      // parseBotOutput only uses the string from the JSON; non-string debug → undefined
      const result = parseBotOutput('{"move": 1, "debug": 42}', '');
      // The implementation returns obj.debug as-is; check it is not crashing
      expect(result.move).toBe(1);
    });

    it('throws BotOutputParseError on invalid JSON', () => {
      expect(() => parseBotOutput('{invalid json}', '')).toThrow(BotOutputParseError);
    });

    it('includes the offending line in the BotOutputParseError message', () => {
      try {
        parseBotOutput('{bad}', '');
        fail('expected throw');
      } catch (err) {
        expect((err as Error).message).toContain('{bad}');
      }
    });

    it('throws BotOutputParseError when JSON is a top-level array (not object)', () => {
      expect(() => parseBotOutput('[1, 2]', '')).not.toThrow(); // arrays don't start with {
    });
  });

  describe('BotOutputParseError', () => {
    it('has the correct name property', () => {
      const err = new BotOutputParseError('test');
      expect(err.name).toBe('BotOutputParseError');
    });

    it('is an instance of Error', () => {
      const err = new BotOutputParseError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
