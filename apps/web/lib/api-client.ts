import type { Account, ApiErrorBody, AuthResponse, MessageResponse } from '@janus/contracts';
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@janus/validation';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private accessToken: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') this.accessToken = sessionStorage.getItem('janus_access');
  }

  async register(input: RegisterInput): Promise<MessageResponse> {
    return this.request('/auth/register', { method: 'POST', body: input }, false);
  }

  async verifyEmail(input: VerifyEmailInput): Promise<MessageResponse> {
    return this.request('/auth/verify-email', { method: 'POST', body: input }, false);
  }

  async resendVerification(input: ResendVerificationInput): Promise<MessageResponse> {
    return this.request('/auth/resend-verification', { method: 'POST', body: input }, false);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const result = await this.request<AuthResponse>(
      '/auth/login',
      { method: 'POST', body: input },
      false,
    );
    this.setAccessToken(result.accessToken);
    return result;
  }

  async refresh(): Promise<AuthResponse> {
    const result = await this.request<AuthResponse>('/auth/refresh', { method: 'POST' }, false);
    this.setAccessToken(result.accessToken);
    return result;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' }, false);
    } finally {
      this.setAccessToken(null);
    }
  }

  async me(): Promise<Account> {
    return this.request('/auth/me', { method: 'GET' });
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<MessageResponse> {
    return this.request('/auth/forgot-password', { method: 'POST', body: input }, false);
  }

  async resetPassword(input: ResetPasswordInput): Promise<MessageResponse> {
    return this.request('/auth/reset-password', { method: 'POST', body: input }, false);
  }

  private setAccessToken(token: string | null): void {
    this.accessToken = token;
    if (typeof window === 'undefined') return;
    if (token) sessionStorage.setItem('janus_access', token);
    else sessionStorage.removeItem('janus_access');
  }

  private async request<T>(
    path: string,
    options: { method: string; body?: unknown },
    retry = true,
  ): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      method: options.method,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-janus-client': 'web',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    if (response.status === 401 && retry && path !== '/auth/refresh') {
      await this.refresh();
      return this.request<T>(path, options, false);
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(
        payload?.error.code ?? 'REQUEST_FAILED',
        payload?.error.message ?? 'The request could not be completed.',
        payload?.error.requestId,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export const apiClient = new ApiClient();
