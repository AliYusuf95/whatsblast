import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getAuthProvider() {
  try {
    return {
      id: process.env.BUN_PUBLIC_OAUTH_PROVIDER_ID as string,
      name: process.env.BUN_PUBLIC_OAUTH_PROVIDER_NAME as string,
    };
  } catch (error) {}
  return undefined;
}

function getApiUrl() {
  try {
    return process.env.BUN_PUBLIC_API_URL;
  } catch (error) {}
  return window.location.origin;
}

export const API_URL = getApiUrl();

export function constructMessage(message: (string | number)[], data?: (string | null)[]): string {
  if (!data) {
    return message.join('');
  }

  return message
    .map((part) => {
      if (typeof part === 'number') {
        return data[part]?.toString() || '';
      }
      return part;
    })
    .join('');
}
