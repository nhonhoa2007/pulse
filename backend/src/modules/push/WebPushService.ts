import crypto from 'node:crypto';
import net from 'node:net';
import { prisma } from '../../db/PrismaClientSingleton.js';
import { ssrfProtectionGuardService } from '../federation/SsrfProtectionGuardService.js';
import {
  RegisterWebPushSubscriptionInput,
  SendPushNotificationResult,
  WebPushSubscriptionDto,
} from '../../contracts/ApiContracts.js';

export class WebPushService {
  private keyPair: crypto.KeyPairSyncResult<string, string>;
  private publicKeyBase64Url: string;
  private privateKeyObject: crypto.KeyObject;
  private subject: string;

  constructor() {
    this.subject = process.env.VAPID_SUBJECT || 'mailto:admin@pulse.social';

    // Initialize or load NIST P-256 (prime256v1) EC keypair for VAPID
    const generated = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    this.keyPair = generated;
    this.privateKeyObject = crypto.createPrivateKey(generated.privateKey);

    // Derive standard 65-byte uncompressed public key (0x04 || X || Y)
    const jwk = crypto.createPublicKey(generated.publicKey).export({ format: 'jwk' });
    const x = Buffer.from(jwk.x!, 'base64url');
    const y = Buffer.from(jwk.y!, 'base64url');
    const uncompressedPub = Buffer.concat([Buffer.from([0x04]), x, y]);
    this.publicKeyBase64Url = uncompressedPub.toString('base64url');
  }

  /**
   * Return the uncompressed P-256 VAPID Public Key in Base64URL encoding (RFC 8292)
   */
  public getVapidPublicKey(): string {
    return this.publicKeyBase64Url;
  }

  /**
   * Generate an ES256 signed VAPID JWT token for the target push service audience origin
   */
  public generateVapidToken(audience: string): string {
    const header = {
      alg: 'ES256',
      typ: 'JWT',
    };

    const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 hours expiration
    const payload = {
      aud: audience,
      exp,
      sub: this.subject,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const unsignedToken = `${headerB64}.${payloadB64}`;

    const signature = crypto.sign('SHA256', Buffer.from(unsignedToken, 'utf8'), {
      key: this.privateKeyObject,
      dsaEncoding: 'ieee-p1363', // 64 bytes (R || S) JWS ES256 format
    });

    return `${unsignedToken}.${signature.toString('base64url')}`;
  }

  /**
   * Validate push endpoint URL against SSRF attack vectors.
   */
  public async validatePushEndpoint(endpoint: string): Promise<{ safe: boolean; error?: string }> {
    if (!endpoint || typeof endpoint !== 'string') {
      return { safe: false, error: 'Endpoint must be a non-empty string' };
    }

    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      return { safe: false, error: 'Endpoint must be a valid URL' };
    }

    const rawHostname = parsed.hostname;
    const hostname = rawHostname.replace(/^\[|\]$/g, '').trim().toLowerCase();
    const portNum = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;

    // 1. Cloud metadata addresses (AWS, GCP, Azure, Oracle) MUST ALWAYS be strictly blocked
    const cloudMetadataHosts = [
      '169.254.169.254',
      'metadata.google.internal',
      'instance-data',
      '169.254.169.253',
      '100.100.100.200',
    ];
    if (
      cloudMetadataHosts.includes(hostname) ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      return { safe: false, error: `SSRF_BLOCKED: Access to cloud metadata endpoint '${hostname}' is prohibited` };
    }

    if (hostname.startsWith('::ffff:')) {
      const parts = hostname.split(':');
      const last = parts[parts.length - 1];
      if (cloudMetadataHosts.includes(last)) {
        return { safe: false, error: `SSRF_BLOCKED: Access to IPv4-mapped metadata IP '${hostname}' is prohibited` };
      }
    }

    // 2. Dangerous internal service ports
    const dangerousPorts = [
      21, 22, 23, 25, 53, 69, 110, 119, 123, 135, 137, 138, 139, 143, 161, 389, 445,
      5432, 6379, 8086, 9200, 11211, 27017, 28017,
    ];
    if (dangerousPorts.includes(portNum)) {
      return { safe: false, error: `FORBIDDEN_PORT: Port ${portNum} is blocked to prevent protocol smuggling` };
    }

    // 3. Test environment mock handling: Allow local mock server if port > 1024
    const isMockTestServer =
      (process.env.NODE_ENV === 'test' || process.env.ALLOW_HTTP_FEDERATION === 'true') &&
      (hostname === '127.0.0.1' || hostname === 'localhost') &&
      portNum > 1024 &&
      !dangerousPorts.includes(portNum);

    if (isMockTestServer) {
      return { safe: true };
    }

    // 4. In all other cases, enforce HTTPS and no private/loopback/reserved IPs
    if (parsed.protocol !== 'https:') {
      return { safe: false, error: `INSECURE_PROTOCOL: Push endpoints must use HTTPS protocol (got ${parsed.protocol})` };
    }

    if (hostname === 'localhost' || ssrfProtectionGuardService.isPrivateIp(hostname)) {
      return { safe: false, error: `SSRF_BLOCKED: Destination '${hostname}' is a private, loopback, or reserved IP address` };
    }

    // 5. Check URL with ssrfProtectionGuardService
    const ssrfCheck = await ssrfProtectionGuardService.isSafeUrl(endpoint, {
      allowPrivateForTesting: false,
    });
    if (!ssrfCheck.safe) {
      return { safe: false, error: ssrfCheck.error || 'Destination rejected by SSRF guard' };
    }

    return { safe: true };
  }

  /**
   * Verify an ES256 VAPID JWT token according to RFC 8292.
   */
  public verifyVapidToken(
    token: string,
    expectedAudience?: string
  ): { valid: boolean; claims?: any; error?: string } {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'MALFORMED_TOKEN: Token must be a non-empty string' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'MALFORMED_TOKEN: JWT must have exactly 3 parts separated by dots' };
    }

    const [headerB64, payloadB64, sigB64] = parts;

    let header: any;
    let payload: any;
    try {
      header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      return { valid: false, error: 'MALFORMED_TOKEN: Failed to parse header or payload JSON' };
    }

    if (header.alg !== 'ES256' || header.typ !== 'JWT') {
      return { valid: false, error: `INVALID_ALGORITHM: Expected alg ES256 and typ JWT, got ${header.alg}/${header.typ}` };
    }

    if (!payload.aud || !payload.exp || !payload.sub) {
      return { valid: false, error: 'MISSING_CLAIMS: VAPID token must include aud, exp, and sub claims' };
    }

    if (expectedAudience && payload.aud !== expectedAudience) {
      return { valid: false, error: `AUDIENCE_MISMATCH: Expected ${expectedAudience}, got ${payload.aud}` };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      return { valid: false, error: 'TOKEN_EXPIRED: Token expiration timestamp is in the past' };
    }

    const unsignedData = `${headerB64}.${payloadB64}`;
    const sigBuf = Buffer.from(sigB64, 'base64url');

    try {
      const isValid = crypto.verify(
        'SHA256',
        Buffer.from(unsignedData, 'utf8'),
        {
          key: this.keyPair.publicKey,
          dsaEncoding: 'ieee-p1363',
        },
        sigBuf
      );

      if (!isValid) {
        return { valid: false, error: 'INVALID_SIGNATURE: Signature verification failed' };
      }

      return { valid: true, claims: payload };
    } catch (err: any) {
      return { valid: false, error: `VERIFICATION_FAILED: ${err?.message || 'Cryptographic verification failed'}` };
    }
  }

  /**
   * Register or update a browser push subscription for a user
   */
  public async registerSubscription(
    userId: string,
    input: RegisterWebPushSubscriptionInput
  ): Promise<WebPushSubscriptionDto> {
    if (!input || !input.endpoint || typeof input.endpoint !== 'string') {
      throw new Error('Valid subscription endpoint URL is required');
    }

    const ssrfCheck = await this.validatePushEndpoint(input.endpoint);
    if (!ssrfCheck.safe) {
      const err: any = new Error(`SSRF_GUARD_BLOCKED: ${ssrfCheck.error}`);
      err.code = 'SSRF_GUARD_BLOCKED';
      err.statusCode = 400;
      throw err;
    }

    if (!input.keys || !input.keys.p256dh || !input.keys.auth) {
      throw new Error('Subscription keys (p256dh and auth) are required');
    }

    const sub = await prisma.webPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent || null,
      },
      update: {
        userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent || null,
      },
    });

    return {
      id: sub.id,
      userId: sub.userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      userAgent: sub.userAgent,
      createdAt: sub.createdAt.toISOString(),
    };
  }

  /**
   * Delete a push subscription
   */
  public async unregisterSubscription(userId: string, endpoint: string): Promise<boolean> {
    if (!endpoint) {
      throw new Error('Endpoint is required');
    }

    const res = await prisma.webPushSubscription.deleteMany({
      where: {
        endpoint,
        userId,
      },
    });

    return res.count > 0;
  }

  /**
   * Deliver push notification to a specific subscription.
   * Auto-prunes subscription if push service returns HTTP 404 or 410.
   */
  public async sendNotification(
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload?: unknown
  ): Promise<SendPushNotificationResult> {
    const ssrfCheck = await this.validatePushEndpoint(subscription.endpoint);
    if (!ssrfCheck.safe) {
      return {
        success: false,
        endpoint: subscription.endpoint,
        error: `SSRF_GUARD_BLOCKED: ${ssrfCheck.error}`,
      };
    }

    let audience: string;
    try {
      const url = new URL(subscription.endpoint);
      audience = `${url.protocol}//${url.host}`;
    } catch {
      return {
        success: false,
        endpoint: subscription.endpoint,
        error: 'Invalid endpoint URL',
      };
    }

    const vapidToken = this.generateVapidToken(audience);

    const headers: Record<string, string> = {
      Authorization: `vapid t=${vapidToken}, k=${this.publicKeyBase64Url}`,
      TTL: '86400',
      Urgency: 'normal',
    };

    let bodyData: string | undefined;
    if (payload !== undefined) {
      bodyData = typeof payload === 'string' ? payload : JSON.stringify(payload);
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers,
        body: bodyData,
      });

      // Auto-pruning: HTTP 404 (Not Found) or 410 (Gone) indicates expired/unregistered endpoint
      if (response.status === 404 || response.status === 410) {
        await prisma.webPushSubscription.deleteMany({
          where: { endpoint: subscription.endpoint },
        });

        return {
          success: false,
          endpoint: subscription.endpoint,
          statusCode: response.status,
          error: `Subscription expired (${response.status}) and was automatically pruned`,
        };
      }

      if (!response.ok) {
        return {
          success: false,
          endpoint: subscription.endpoint,
          statusCode: response.status,
          error: `Push service rejected notification with HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        endpoint: subscription.endpoint,
        statusCode: response.status,
      };
    } catch (err: any) {
      return {
        success: false,
        endpoint: subscription.endpoint,
        error: err?.message || 'Failed to dispatch push notification',
      };
    }
  }

  /**
   * Send notification to all subscriptions of a user
   */
  public async sendNotificationToUser(
    userId: string,
    payload: unknown
  ): Promise<SendPushNotificationResult[]> {
    const subscriptions = await prisma.webPushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      return [];
    }

    const results = await Promise.all(
      subscriptions.map((sub) => this.sendNotification(sub, payload))
    );

    return results;
  }
}

export const webPushService = new WebPushService();
