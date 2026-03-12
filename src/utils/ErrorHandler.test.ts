// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorHandler } from '@/utils/ErrorHandler';

describe('ErrorHandler', () => {
  describe('attempt()', () => {
    it('returns the function result on success', () => {
      const result = ErrorHandler.attempt(() => 42, 'test');
      expect(result).toBe(42);
    });

    it('returns undefined when the function throws', () => {
      const result = ErrorHandler.attempt(() => { throw new Error('boom'); }, 'test');
      expect(result).toBeUndefined();
    });

    it('returns the fallback when the function throws', () => {
      const result = ErrorHandler.attempt(() => { throw new Error('boom'); }, 'test', -1);
      expect(result).toBe(-1);
    });

    it('does not rethrow the caught error', () => {
      expect(() => {
        ErrorHandler.attempt(() => { throw new Error('silent'); }, 'test');
      }).not.toThrow();
    });
  });

  describe('attemptAsync()', () => {
    it('returns the resolved value on success', async () => {
      const result = await ErrorHandler.attemptAsync(async () => 'hello', 'async-test');
      expect(result).toBe('hello');
    });

    it('returns undefined when the async function rejects', async () => {
      const result = await ErrorHandler.attemptAsync(
        async () => { throw new Error('async boom'); },
        'async-test',
      );
      expect(result).toBeUndefined();
    });

    it('returns the fallback when the async function rejects', async () => {
      const result = await ErrorHandler.attemptAsync(
        async () => { throw new Error('async boom'); },
        'async-test',
        99,
      );
      expect(result).toBe(99);
    });
  });

  describe('localStorage helpers', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('localStorageSet and localStorageGet round-trip a value', () => {
      ErrorHandler.localStorageSet('test-key', 'hello');
      expect(ErrorHandler.localStorageGet('test-key')).toBe('hello');
    });

    it('localStorageGet returns null for missing keys', () => {
      expect(ErrorHandler.localStorageGet('nonexistent')).toBeNull();
    });

    it('localStorageRemove deletes a key', () => {
      ErrorHandler.localStorageSet('rm-key', 'val');
      ErrorHandler.localStorageRemove('rm-key');
      expect(ErrorHandler.localStorageGet('rm-key')).toBeNull();
    });

    it('localStorageGet does not throw when localStorage throws', () => {
      const orig = Object.getOwnPropertyDescriptor(window, 'localStorage');
      // Simulate a broken localStorage (e.g., private mode on some browsers)
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied');
      });
      expect(() => ErrorHandler.localStorageGet('key')).not.toThrow();
      expect(ErrorHandler.localStorageGet('key')).toBeNull();
      vi.restoreAllMocks();
      // restore descriptor if needed
      if (orig) Object.defineProperty(window, 'localStorage', orig);
    });

    it('localStorageSet does not throw when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      expect(() => ErrorHandler.localStorageSet('key', 'value')).not.toThrow();
      vi.restoreAllMocks();
    });
  });
});
