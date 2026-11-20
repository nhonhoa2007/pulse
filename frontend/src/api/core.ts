/**
 * Transport layer của Pulse API client (INF-04).
 *
 * Chịu trách nhiệm: quản lý token/refresh, envelope `{ success, data }`,
 * lỗi chuẩn hoá. Các domain method (posts, feed, dm, federation...) nằm ở
 * PulseApiClient và mở rộng class này.
 */
import type { ApiResponse } from '../types/PulseTypes';

// SEC-06: môi trường dev detection. Optional chaining để module chạy được
// dưới Node thuần (node --test); vite build thay thế import.meta.env tĩnh.
export const IS_DEV: boolean = (import.meta as any).env?.DEV ?? true;

export class ApiError extends Error {
  public readonly status: number | null;
  public readonly code: string;

  constructor(message: string, status: number | null, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class PulseApiCore {
  protected activeUserId: string = '';
  protected token: string | null = null;
  protected baseUrl: string = '/api/v1';

  constructor() {
    // Restore saved user if present
    if (typeof window !== 'undefined') {
      const savedUserId = localStorage.getItem('pulse_active_user_id');
      if (savedUserId) {
        this.activeUserId = savedUserId;
      }
      // Access tokens are intentionally memory-only. Clear the legacy value
      // once; an HttpOnly refresh cookie is used to restore the session.
      localStorage.removeItem('pulse_auth_token');
    }
  }

  public getActiveUserId(): string {
    return this.activeUserId;
  }

  public setActiveUserId(userId: string): void {
    this.activeUserId = userId;
    if (typeof window !== 'undefined') {
      localStorage.setItem('pulse_active_user_id', userId);
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public setToken(token: string | null): void {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('pulse_auth_token');
    }
  }

  private refreshPromise: Promise<string | null> | null = null;

  protected async request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
    const requestUserId = this.activeUserId;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers as Record<string, string>),
    };

    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    let res: Response;
    try {
      res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể kết nối tới máy chủ';
      throw new ApiError(message, null, 'NETWORK_ERROR');
    }

    // TASK-21: Handle 401 Unauthorized with Automatic Token Refresh
    const isAuthEndpoint =
      endpoint.includes('/auth/login') ||
      endpoint.includes('/auth/register') ||
      endpoint.includes('/auth/refresh') ||
      endpoint.includes('/auth/logout');

    if (res.status === 401 && !isRetry && !isAuthEndpoint) {
      try {
        if (!this.refreshPromise) {
          this.refreshPromise = (async () => {
            try {
              const refreshRes = await fetch(`${this.baseUrl}/auth/refresh`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
              });

              if (!refreshRes.ok) {
                return null;
              }

              const data = await refreshRes.json();
              const payload = data.data || data;
              const newAccessToken = payload.accessToken || payload.token;

              if (newAccessToken) {
                if (
                  this.activeUserId !== requestUserId ||
                  (payload.user?.id && payload.user.id !== requestUserId)
                ) return null;
                this.setToken(newAccessToken);
                if (payload.user?.id) {
                  this.setActiveUserId(payload.user.id);
                }
                return newAccessToken;
              }
              return null;
            } catch {
              return null;
            } finally {
              this.refreshPromise = null;
            }
          })();
        }

        const refreshedToken = await this.refreshPromise;
        if (refreshedToken) {
          if (this.activeUserId !== requestUserId) {
            throw new ApiError('Session changed while the request was pending', 401, 'SESSION_CHANGED');
          }
          // Retry original request with the new access token
          return this.request<T>(endpoint, options, true);
        }
      } catch {
        // If refresh fails, fall through to default error handling
      }
    }

    const contentType = res.headers.get('content-type');
    const isJson = contentType && contentType.includes('application/json');

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status} - ${res.statusText}`;
      let errorCode = res.status === 401 ? 'UNAUTHORIZED' : `HTTP_${res.status}`;
      if (isJson) {
        try {
          const errData = await res.json();
          if (errData.error?.code) {
            errorCode = errData.error.code;
          }
          if (errData.error?.message) {
            errorMessage = errData.error.message;
          } else if (errData.message) {
            errorMessage = errData.message;
          }
        } catch {
          // ignore parse failure
        }
      }
      throw new ApiError(errorMessage, res.status, errorCode);
    }

    if (isJson) {
      const json: ApiResponse<T> | T = await res.json();
      // If the backend wraps responses in { success: true, data: ... }
      if (typeof json === 'object' && json !== null && 'success' in json && 'data' in json) {
        return (json as ApiResponse<T>).data as T;
      }
      return json as T;
    }

    return null as unknown as T;
  }
}
