import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { getJwtSecret } from '../../config/Secrets.js';

export class TokenRevocationManager {
  private revokedSet = new Map<string, number>();
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
        select: { tokenSignature: true, expiresAt: true },
      });

      for (const record of activeRecords) {
        this.revokedSet.set(record.tokenSignature, record.expiresAt.getTime());
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
    // Fast in-memory registration
    let expiresAt: Date;
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { exp?: number; userId?: string };
      if (typeof decoded.exp !== 'number') return;
      expiresAt = new Date(decoded.exp * 1000);
      userId = userId || decoded.userId;
    } catch {
      return;
    }
    if (expiresAt <= new Date()) return;

    try {
      this.pruneMemory();
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
      this.revokedSet.set(signature, expiresAt.getTime());
    } catch (err) {
      throw err;
    }
  }

  /**
   * Checks if an access token or its signature has been revoked. O(1) complexity.
   */
  public isRevoked(token: string): boolean {
    if (!token) return false;
    this.pruneMemory();
    const signature = this.extractSignature(token);
    return this.revokedSet.has(signature);
  }

  private pruneMemory(): void {
    const now = Date.now();
    for (const [signature, expiresAt] of this.revokedSet) {
      if (expiresAt <= now) this.revokedSet.delete(signature);
    }
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
