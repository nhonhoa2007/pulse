import { FastifyRequest, FastifyReply } from 'fastify';
import {
  authService,
  AuthValidationError,
  AuthUnauthorizedError,
  AuthNotFoundError,
} from './AuthService.js';
import {
  ApiResponse,
  RegisterInput,
  LoginInput,
  AuthResponseData,
  UserDto,
  RefreshTokenResponseDto,
  LogoutResponseDto,
} from '../../contracts/ApiContracts.js';

export class AuthController {
  private setRefreshTokenCookie(reply: FastifyReply, refreshToken: string): void {
    const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
    reply.setCookie('pulse_refresh_token', refreshToken, {
      path: '/api/v1/auth',
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });
  }

  private extractRefreshToken(req: FastifyRequest): string | undefined {
    let rawToken: string | undefined = req.cookies?.pulse_refresh_token;
    if (rawToken && (req as any).unsignCookie) {
      const unsigned = (req as any).unsignCookie(rawToken);
      if (unsigned.valid) {
        rawToken = unsigned.value;
      }
    }
    return rawToken || (req.body as any)?.refreshToken;
  }

  public async register(
    req: FastifyRequest<{ Body: RegisterInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<AuthResponseData>> {
    try {
      const result = await authService.register(req.body);

      // Set HttpOnly Secure SameSite=Strict Cookie
      this.setRefreshTokenCookie(reply, result.refreshToken);

      reply.status(201);
      return {
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          token: result.accessToken,
        },
      };
    } catch (err: unknown) {
      if (err instanceof AuthValidationError) {
        reply.status(400);
        return {
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        };
      }

      const message = err instanceof Error ? err.message : 'Registration failed';
      reply.status(400);
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message,
        },
      };
    }
  }

  public async login(
    req: FastifyRequest<{ Body: LoginInput }>,
    reply: FastifyReply
  ): Promise<ApiResponse<AuthResponseData>> {
    try {
      const result = await authService.login(req.body);

      // Set HttpOnly Secure SameSite=Strict Cookie
      this.setRefreshTokenCookie(reply, result.refreshToken);

      return {
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken,
          token: result.accessToken,
        },
      };
    } catch (err: unknown) {
      if (err instanceof AuthUnauthorizedError) {
        reply.status(401);
        return {
          success: false,
          error: {
            code: err.code || 'UNAUTHORIZED',
            message: err.message,
          },
        };
      }

      if (err instanceof AuthValidationError) {
        reply.status(400);
        return {
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        };
      }

      reply.status(401);
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Tên đăng nhập hoặc mật khẩu không đúng',
        },
      };
    }
  }

  public async refreshToken(
    req: FastifyRequest<{ Body?: { refreshToken?: string } }>,
    reply: FastifyReply
  ): Promise<ApiResponse<RefreshTokenResponseDto>> {
    const refreshToken = this.extractRefreshToken(req);

    if (!refreshToken) {
      reply.status(401);
      return {
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Mã làm mới không tồn tại',
        },
      };
    }

    try {
      const result = await authService.rotateRefreshToken(refreshToken);

      // Rotate HttpOnly Cookie
      this.setRefreshTokenCookie(reply, result.refreshToken);

      return {
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Mã làm mới không hợp lệ hoặc đã hết hạn';
      const code = (err as any).code || 'INVALID_REFRESH_TOKEN';
      reply.status(401);
      return {
        success: false,
        error: {
          code,
          message,
        },
      };
    }
  }

  public async logout(
    req: FastifyRequest<{ Body?: { refreshToken?: string } }>,
    reply: FastifyReply
  ): Promise<ApiResponse<LogoutResponseDto> & { message?: string }> {
    const refreshToken = this.extractRefreshToken(req);

    let accessToken: string | undefined;
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') {
      const match = authHeader.match(/^bearer\s+(.+)$/i);
      if (match) {
        accessToken = match[1].trim();
      }
    }

    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId || null;

    try {
      await authService.logout(refreshToken, accessToken, currentUserId);
    } catch (err) {
      console.error('Logout revocation error:', err);
    }

    const isSecure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
    reply.clearCookie('pulse_refresh_token', {
      path: '/api/v1/auth',
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
    });

    return {
      success: true,
      message: 'Đăng xuất thành công',
      data: {
        success: true,
        message: 'Đăng xuất thành công',
      },
    };
  }

  public async getMe(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<ApiResponse<{ user: UserDto }>> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;

    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Yêu cầu xác thực',
        },
      };
    }

    try {
      const user = await authService.getMe(currentUserId);
      return {
        success: true,
        data: { user },
      };
    } catch (err: unknown) {
      if (err instanceof AuthNotFoundError) {
        reply.status(404);
        return {
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: err.message,
          },
        };
      }

      reply.status(500);
      return {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Lỗi máy chủ nội bộ',
        },
      };
    }
  }
}

export const authController = new AuthController();
