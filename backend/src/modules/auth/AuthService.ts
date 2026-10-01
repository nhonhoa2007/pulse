import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { tokenRevocationManager } from './TokenRevocationManager.js';
import {
  RegisterInput,
  LoginInput,
  AuthResponseData,
  UserDto,
} from '../../contracts/ApiContracts.js';

export class AuthValidationError extends Error {
  constructor(message: string, public code: string = 'BAD_REQUEST') {
    super(message);
    this.name = 'AuthValidationError';
  }
}

export class AuthUnauthorizedError extends Error {
  constructor(message: string = 'Tên đăng nhập hoặc mật khẩu không đúng', public code: string = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthUnauthorizedError';
  }
}

export class AuthNotFoundError extends Error {
  constructor(message: string = 'Không tìm thấy người dùng') {
    super(message);
    this.name = 'AuthNotFoundError';
  }
}

export function toUserDto(user: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  isCelebrity: boolean;
  isPrivate?: boolean;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  createdAt: Date;
  isFollowing?: boolean;
  isBlocked?: boolean;
  hasPendingFollowRequest?: boolean;
  isLocked?: boolean;
  isRemote?: boolean;
  domain?: string | null;
  actorUri?: string | null;
}): UserDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isCelebrity: user.isCelebrity,
    isPrivate: Boolean(user.isPrivate),
    followersCount: user.followersCount,
    followingCount: user.followingCount,
    postsCount: user.postsCount,
    ...(user.isFollowing !== undefined ? { isFollowing: user.isFollowing } : {}),
    ...(user.isBlocked !== undefined ? { isBlocked: user.isBlocked } : {}),
    ...(user.hasPendingFollowRequest !== undefined ? { hasPendingFollowRequest: user.hasPendingFollowRequest } : {}),
    ...(user.isLocked !== undefined ? { isLocked: user.isLocked } : {}),
    ...(user.isRemote !== undefined ? { isRemote: user.isRemote } : {}),
    ...(user.domain !== undefined ? { domain: user.domain } : {}),
    ...(user.actorUri !== undefined ? { actorUri: user.actorUri } : {}),
    createdAt: user.createdAt.toISOString(),
  };
}

export interface DualTokenAuthResult extends AuthResponseData {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  private get jwtSecret(): string {
    return process.env.JWT_SECRET || 'pulse-secret-key-2026-production-token';
  }

  /**
   * Generates short-lived Access Token (15 minutes) for zero-trust session security.
   */
  public generateAccessToken(userId: string, username: string): string {
    return jwt.sign(
      { userId, username, jti: crypto.randomUUID() },
      this.jwtSecret,
      { expiresIn: '15m' }
    );
  }

  /**
   * Backward compatible token generator alias.
   */
  public generateToken(userId: string, username: string): string {
    return this.generateAccessToken(userId, username);
  }

  /**
   * Generates and stores long-lived cryptographically secure Refresh Token (7 days).
   */
  public async createRefreshToken(userId: string): Promise<string> {
    const rawRefreshToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        isRevoked: false,
      },
    });

    return rawRefreshToken;
  }

  public async register(input: RegisterInput): Promise<DualTokenAuthResult> {
    const { username, email, password, displayName } = input || {};

    // 1. Validation
    if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      throw new AuthValidationError(
        'Tên người dùng phải từ 3-30 ký tự, chỉ gồm chữ cái, số và dấu gạch dưới',
        'INVALID_USERNAME'
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
      throw new AuthValidationError('Địa chỉ email không hợp lệ', 'INVALID_EMAIL');
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new AuthValidationError('Mật khẩu phải có ít nhất 6 ký tự', 'INVALID_PASSWORD');
    }

    if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
      throw new AuthValidationError('Tên hiển thị không được để trống', 'INVALID_DISPLAY_NAME');
    }

    // 2. Check if username or email already taken
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: username, mode: 'insensitive' } },
          { email: { equals: email, mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      const isUsernameTaken = existing.username.toLowerCase() === username.toLowerCase();
      throw new AuthValidationError(
        isUsernameTaken ? 'Tên người dùng đã được sử dụng' : 'Email đã được sử dụng',
        'USER_ALREADY_EXISTS'
      );
    }

    // 3. Hash password using bcryptjs (salt rounds 10)
    const passwordHash = await bcrypt.hash(password, 10);

    // 4. Create user in database with passwordHash
    const user = await prisma.user.create({
      data: {
        username,
        email,
        displayName: displayName.trim(),
        passwordHash,
      },
    });

    // 5. Generate Dual Tokens: Access Token (15m) and Refresh Token (7d)
    const accessToken = this.generateAccessToken(user.id, user.username);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: toUserDto(user),
      token: accessToken,
      accessToken,
      refreshToken,
    };
  }

  public async login(input: LoginInput): Promise<DualTokenAuthResult> {
    const { identifier, password } = input || {};

    if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
      throw new AuthUnauthorizedError('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    const trimmedIdentifier = identifier.trim();

    // Find user by username OR email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: trimmedIdentifier, mode: 'insensitive' } },
          { email: { equals: trimmedIdentifier, mode: 'insensitive' } },
        ],
      },
    });

    if (!user || !user.passwordHash) {
      throw new AuthUnauthorizedError('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new AuthUnauthorizedError('Tên đăng nhập hoặc mật khẩu không đúng');
    }

    // Generate Dual Tokens: Access Token (15m) and Refresh Token (7d)
    const accessToken = this.generateAccessToken(user.id, user.username);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: toUserDto(user),
      token: accessToken,
      accessToken,
      refreshToken,
    };
  }

  public async rotateRefreshToken(rawRefreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: UserDto;
  }> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
      throw new AuthUnauthorizedError('Mã làm mới không hợp lệ hoặc đã hết hạn', 'INVALID_REFRESH_TOKEN');
    }

    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing || existing.isRevoked || existing.expiresAt < new Date()) {
      if (existing && existing.isRevoked) {
        await prisma.refreshToken.updateMany({
          where: { userId: existing.userId },
          data: { isRevoked: true },
        });
      }
      throw new AuthUnauthorizedError('Mã làm mới không hợp lệ hoặc đã hết hạn', 'INVALID_REFRESH_TOKEN');
    }

    // Atomic Token Rotation: Invalidate old token, mint fresh pair
    // Concurrency defense: Use atomic compare-and-swap (CAS) inside transaction to prevent microsecond replay race
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.refreshToken.updateMany({
        where: {
          id: existing.id,
          isRevoked: false,
        },
        data: { isRevoked: true },
      });

      if (updated.count === 0) {
        // Concurrent replay race detected! Revoke all tokens in family
        await tx.refreshToken.updateMany({
          where: { userId: existing.userId },
          data: { isRevoked: true },
        });
        throw new AuthUnauthorizedError('Mã làm mới không hợp lệ hoặc đã hết hạn', 'INVALID_REFRESH_TOKEN');
      }

      const newRawRefreshToken = crypto.randomBytes(40).toString('hex');
      const newTokenHash = crypto.createHash('sha256').update(newRawRefreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: newTokenHash,
          expiresAt,
          isRevoked: false,
        },
      });

      const newAccessToken = this.generateAccessToken(existing.user.id, existing.user.username);

      return {
        accessToken: newAccessToken,
        refreshToken: newRawRefreshToken,
        user: toUserDto(existing.user),
      };
    });
  }

  public async logout(
    rawRefreshToken?: string | null,
    accessToken?: string | null,
    userId?: string | null
  ): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
      await prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { isRevoked: true },
      });
    }

    if (accessToken) {
      await tokenRevocationManager.revokeToken(accessToken, userId, 'USER_LOGOUT');
    }
  }

  public async getMe(userId: string): Promise<UserDto> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AuthNotFoundError('Không tìm thấy người dùng');
    }

    return toUserDto(user);
  }
}

export const authService = new AuthService();
