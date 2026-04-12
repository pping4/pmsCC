import { randomBytes } from 'crypto';

/**
 * Generate a CUID-like unique ID string (25 chars)
 * Format: 'c' + 24 hex characters for database compatibility
 */
export function generateId(): string {
  return 'c' + randomBytes(12).toString('hex');
}
