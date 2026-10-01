import crypto from 'crypto';
import { prisma } from '../../db/PrismaClientSingleton.js';

export interface KeyPairResult {
  id: string;
  userId: string | null;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export class ActivityPubKeyManagerService {
  /**
   * Resolve default server domain
   */
  public getDomain(hostHeader?: string): string {
    if (process.env.PULSE_DOMAIN) return process.env.PULSE_DOMAIN;
    if (process.env.SERVER_DOMAIN) return process.env.SERVER_DOMAIN;
    if (hostHeader) {
      // Strip port if production standard or keep hostHeader
      return hostHeader;
    }
    if (process.env.NODE_ENV === 'test') {
      return 'localhost:3001';
    }
    return 'pulse.social';
  }

  /**
   * Generates standard RSA 2048-bit keypair in PEM format
   */
  public generateRsa2048KeyPair(): { publicKeyPem: string; privateKeyPem: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    return {
      publicKeyPem: publicKey,
      privateKeyPem: privateKey,
    };
  }

  /**
   * Retrieves or provisions the Instance Actor RSA keypair (userId: null)
   */
  public async getOrCreateInstanceKey(domain?: string): Promise<KeyPairResult> {
    const serverDomain = domain || this.getDomain();
    const keyId = `https://${serverDomain}/actor#main-key`;

    const existing = await prisma.federationKey.findFirst({
      where: { userId: null },
    });

    if (existing) {
      return existing;
    }

    const { publicKeyPem, privateKeyPem } = this.generateRsa2048KeyPair();

    const created = await prisma.federationKey.create({
      data: {
        userId: null,
        keyId,
        publicKeyPem,
        privateKeyPem,
      },
    });

    return created;
  }

  /**
   * Retrieves or provisions a User Actor RSA keypair
   */
  public async getOrCreateUserKey(
    userId: string,
    username: string,
    domain?: string
  ): Promise<KeyPairResult> {
    const serverDomain = domain || this.getDomain();
    const keyId = `https://${serverDomain}/users/${username}#main-key`;

    const existing = await prisma.federationKey.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing;
    }

    const { publicKeyPem, privateKeyPem } = this.generateRsa2048KeyPair();

    const created = await prisma.federationKey.upsert({
      where: { userId },
      create: {
        userId,
        keyId,
        publicKeyPem,
        privateKeyPem,
      },
      update: {
        keyId,
        publicKeyPem,
        privateKeyPem,
      },
    });

    return created;
  }
}

export const activityPubKeyManagerService = new ActivityPubKeyManagerService();
