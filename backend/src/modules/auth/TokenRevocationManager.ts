import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/PrismaClientSingleton.js';

export class TokenRevocationManager {
  private revokedSet: Set<string> = new Set();
  private isInitialized = false;

  /**
   * Initializes the in-memory cache by loading all unexpired revoked token signatures from PostgreSQL.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const now = new Date();
      const activeRecords = await prisma.revokedToken.findMany({
        where: {
          expiresAt: { gt: now },
        },
        select: {
          tokenSignature: true,
        },
      });

      for (const record of activeRecords) {
        this.revokedSet.add(record.tokenSignature);
      }
      this.isInitialized = true;
    } catch (err) {
      console.error('Failed to initialize TokenRevocationManager from database:', err);
    }
  }

  /**
   * Extracts token signature (3rd segment of JWT) or computes SHA-256 fallback.
   */
  public extractSignature(token: string): string {
    const parts = token.split('.');
    if (parts.length === 3 && parts[2]) {
      return parts[2];
    }
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Hashes the raw token to SHA-256 string.
   */
  public hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Revokes an access token immediately:
   * 1. Adds signature and sha256 to in-memory set for O(1) checks
   * 2. Persists revocation record in PostgreSQL RevokedToken table
   */
  public async revokeToken(token: string, userId?: string | null, reason: string = 'LOGOUT'): Promise<void> {
    if (!token) return;

    const signature = this.extractSignature(token);
    const sha256 = this.hashToken(token);

    // Fast in-memory registration
    this.revokedSet.add(signature);
    this.revokedSet.add(sha256);
    this.revokedSet.add(token);

    // Determine token expiration from JWT exp claim
    let expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Default fallback: 15 minutes
    try {
      const decoded = jwt.decode(token) as { exp?: number; userId?: string } | null;
      if (decoded && typeof decoded.exp === 'number') {
        expiresAt = new Date(decoded.exp * 1000);
      }
      if (!userId && decoded && decoded.userId) {
        userId = decoded.userId;
      }
    } catch {
      // Keep default 15m expiration
    }

    try {
      await prisma.revokedToken.upsert({
        where: { tokenSignature: signature },
        update: {
          expiresAt,
          reason,
          userId: userId || undefined,
        },
        create: {
          tokenSignature: signature,
          expiresAt,
          reason,
          userId: userId || undefined,
        },
      });
    } catch (err) {
      console.error('Failed to persist revoked token to PostgreSQL:', err);
    }
  }

  /**
   * Checks if an access token or its signature has been revoked. O(1) complexity.
   */
  public isRevoked(token: string): boolean {
    if (!token) return false;
    const signature = this.extractSignature(token);
    const sha256 = this.hashToken(token);

    return this.revokedSet.has(signature) || this.revokedSet.has(sha256) || this.revokedSet.has(token);
  }

  /**
   * Cleans up expired revocation records from database.
   */
  public async pruneExpired(): Promise<number> {
    const now = new Date();
    try {
      const result = await prisma.revokedToken.deleteMany({
        where: {
          expiresAt: { lte: now },
        },
      });
      return result.count;
    } catch (err) {
      console.error('Failed to prune expired revoked tokens:', err);
      return 0;
    }
  }
}

export const tokenRevocationManager = new TokenRevocationManager();
