import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}
