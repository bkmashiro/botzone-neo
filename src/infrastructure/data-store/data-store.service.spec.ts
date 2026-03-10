import { DataStoreService } from './data-store.service';
import * as fs from 'fs/promises';
import type { Stats } from 'fs';
import * as path from 'path';

jest.mock('fs/promises');

const mockedFs = jest.mocked(fs);

describe('DataStoreService', () => {
  let service: DataStoreService;

  beforeEach(() => {
    service = new DataStoreService();
    jest.clearAllMocks();
  });

  describe('getData / setData (in-memory)', () => {
    it('should return empty string for unknown botId', async () => {
      expect(await service.getData('unknown')).toBe('');
    });

    it('should store and retrieve data', async () => {
      await service.setData('bot-1', '{"state":1}');
      expect(await service.getData('bot-1')).toBe('{"state":1}');
    });

    it('should overwrite existing data', async () => {
      await service.setData('bot-1', 'old');
      await service.setData('bot-1', 'new');
      expect(await service.getData('bot-1')).toBe('new');
    });
  });

  describe('clearSessionData', () => {
    it('should clear all in-memory data', async () => {
      await service.setData('bot-1', 'data1');
      await service.setData('bot-2', 'data2');
      service.clearSessionData();
      expect(await service.getData('bot-1')).toBe('');
      expect(await service.getData('bot-2')).toBe('');
    });
  });

  describe('getGlobalData', () => {
    it('should return file content when file exists and is fresh', async () => {
      mockedFs.stat.mockResolvedValue({
        mtimeMs: Date.now() - 1000, // 1 second ago
      } as unknown as Stats);
      mockedFs.readFile.mockResolvedValue('global-data-content');

      const result = await service.getGlobalData('bot-1');
      expect(result).toBe('global-data-content');
    });

    it('should return empty string and delete file when expired', async () => {
      mockedFs.stat.mockResolvedValue({
        mtimeMs: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
      } as unknown as Stats);
      mockedFs.unlink.mockResolvedValue(undefined);

      const result = await service.getGlobalData('bot-1');
      expect(result).toBe('');
      expect(mockedFs.unlink).toHaveBeenCalled();
    });

    it('should return empty string when file does not exist', async () => {
      mockedFs.stat.mockRejectedValue(new Error('ENOENT'));

      const result = await service.getGlobalData('bot-1');
      expect(result).toBe('');
    });

    it('should handle unlink failure gracefully for expired files', async () => {
      mockedFs.stat.mockResolvedValue({
        mtimeMs: Date.now() - 8 * 24 * 60 * 60 * 1000,
      } as unknown as Stats);
      mockedFs.unlink.mockRejectedValue(new Error('EPERM'));

      const result = await service.getGlobalData('bot-1');
      expect(result).toBe('');
    });
  });

  describe('setGlobalData', () => {
    it('should create directory and write file', async () => {
      mockedFs.mkdir.mockResolvedValue(undefined);
      mockedFs.writeFile.mockResolvedValue(undefined);

      await service.setGlobalData('bot-1', '{"global":true}');

      expect(mockedFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('.data', 'globaldata')),
        { recursive: true },
      );
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('bot-1.json'),
        '{"global":true}',
        'utf-8',
      );
    });
  });

  describe('cleanupExpiredGlobalData', () => {
    it('should delete expired files and return count', async () => {
      mockedFs.readdir.mockResolvedValue([
        'bot-1.json',
        'bot-2.json',
        'bot-3.txt', // non-json, skip
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      mockedFs.stat
        .mockResolvedValueOnce({
          mtimeMs: Date.now() - 8 * 24 * 60 * 60 * 1000, // expired
        } as unknown as Stats)
        .mockResolvedValueOnce({
          mtimeMs: Date.now() - 1000, // fresh
        } as unknown as Stats);

      mockedFs.unlink.mockResolvedValue(undefined);

      const cleaned = await service.cleanupExpiredGlobalData();
      expect(cleaned).toBe(1);
      expect(mockedFs.unlink).toHaveBeenCalledTimes(1);
    });

    it('should return 0 when no files exist', async () => {
      mockedFs.readdir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

      const cleaned = await service.cleanupExpiredGlobalData();
      expect(cleaned).toBe(0);
    });

    it('should return 0 when directory does not exist', async () => {
      mockedFs.readdir.mockRejectedValue(new Error('ENOENT'));

      const cleaned = await service.cleanupExpiredGlobalData();
      expect(cleaned).toBe(0);
    });

    it('should skip files that error during stat', async () => {
      mockedFs.readdir.mockResolvedValue(['bot-1.json'] as unknown as Awaited<
        ReturnType<typeof fs.readdir>
      >);
      mockedFs.stat.mockRejectedValue(new Error('ENOENT'));

      const cleaned = await service.cleanupExpiredGlobalData();
      expect(cleaned).toBe(0);
    });
  });
});
