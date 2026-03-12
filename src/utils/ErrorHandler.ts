/**
 * ErrorHandler — centralized runtime error handling and graceful degradation.
 *
 * Registers global handlers for unhandled exceptions and promise rejections so
 * the game can degrade gracefully instead of hard-crashing.  Non-critical
 * errors are logged to the console; truly critical failures surface a
 * user-visible overlay.
 *
 * Usage:
 *   ErrorHandler.install();
 *   // Later, for non-critical work:
 *   const result = ErrorHandler.attempt(() => expensiveOptionalFeature(), 'optional feature');
 */

export class ErrorHandler {
  private static installed = false;

  /**
   * Install global error and promise-rejection handlers.
   * Safe to call multiple times (idempotent).
   */
  static install(): void {
    if (ErrorHandler.installed) return;
    ErrorHandler.installed = true;

    window.addEventListener('error', (event) => {
      console.error('[ErrorHandler] Unhandled error:', event.error ?? event.message);
      // Don't show an overlay for non-critical runtime errors — the game may
      // still be playable.
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error('[ErrorHandler] Unhandled promise rejection:', event.reason);
      // Prevent the browser's default "Uncaught (in promise)" log spam
      event.preventDefault();
    });
  }

  /**
   * Execute `fn` and return its result, or `fallback` if it throws.
   * Errors are logged but never rethrown.
   *
   * @param fn       The function to attempt.
   * @param label    A human-readable label for logging.
   * @param fallback Value to return on failure (default: undefined).
   */
  static attempt<T>(fn: () => T, label: string, fallback?: T): T | undefined {
    try {
      return fn();
    } catch (err) {
      console.warn(`[ErrorHandler] Non-critical failure in "${label}":`, err);
      return fallback;
    }
  }

  /**
   * Execute an async function gracefully, swallowing any rejection.
   */
  static async attemptAsync<T>(
    fn: () => Promise<T>,
    label: string,
    fallback?: T,
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[ErrorHandler] Non-critical async failure in "${label}":`, err);
      return fallback;
    }
  }

  /**
   * Safely read a value from localStorage.
   * Returns `null` when localStorage is unavailable or the key is missing.
   */
  static localStorageGet(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /**
   * Safely write a value to localStorage.
   * Silently swallows quota errors or SecurityError in restricted contexts.
   */
  static localStorageSet(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn('[ErrorHandler] localStorage write failed:', err);
    }
  }

  /**
   * Safely remove a key from localStorage.
   */
  static localStorageRemove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
