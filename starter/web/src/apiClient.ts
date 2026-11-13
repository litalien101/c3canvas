export type AuthAccount = {
  id: string;
  username: string;
  created_at: string;
};

export type AuthSession = {
  account: AuthAccount | null;
  csrf_token: string | null;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body === 'object' && body && 'detail' in body ? body.detail : null;
    const message = typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail
        ? String(detail.message)
        : Array.isArray(detail)
          ? detail.map((item) => {
              if (!item || typeof item !== 'object') return String(item);
              const path = 'loc' in item && Array.isArray(item.loc) ? item.loc.join('.') : 'request';
              const error = 'msg' in item ? String(item.msg) : JSON.stringify(item);
              return `${path}: ${error}`;
            }).join('; ')
          : typeof detail === 'object' && detail
            ? JSON.stringify(detail)
            : 'Request failed.';
    throw new ApiRequestError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
