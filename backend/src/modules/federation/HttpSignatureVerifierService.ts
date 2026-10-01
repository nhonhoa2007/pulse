import crypto from 'crypto';
import { FastifyRequest } from 'fastify';
import { prisma } from '../../db/PrismaClientSingleton.js';
import {
  ParsedHttpSignature,
  HttpSignatureVerifyOptions,
  HttpSignatureVerifyResult,
} from '../../contracts/ActivityPubContracts.js';
import { ssrfProtectionGuardService } from './SsrfProtectionGuardService.js';
import { activityPubKeyManagerService } from './ActivityPubKeyManagerService.js';
import { httpSignatureSignerService } from './HttpSignatureSignerService.js';
import { sanitizeFederatedHtml } from './SanitizeFederatedHtml.js';

export class HttpSignatureVerifierService {
  // Bounded replay prevention cache (max 10,000 entries)
  private readonly maxReplayCacheSize = 10_000;
  private seenSignatures = new Map<string, number>();

  constructor() {
    // Periodic sweep every 60s to prune signatures older than 330 seconds (skew tolerance + buffer)
    setInterval(() => {
      const now = Date.now();
      for (const [sig, ts] of this.seenSignatures.entries()) {
        if (now - ts > 330_000) {
          this.seenSignatures.delete(sig);
        }
      }
    }, 60_000).unref();
  }

  /**
   * Helper to insert a signature into the replay cache with size bounds
   */
  public recordSignature(signature: string, timestamp = Date.now()): void {
    if (this.seenSignatures.size >= this.maxReplayCacheSize) {
      const oldestKey = this.seenSignatures.keys().next().value;
      if (oldestKey) {
        this.seenSignatures.delete(oldestKey);
      }
    }
    this.seenSignatures.set(signature, timestamp);
  }

  /**
   * Helper to check if a signature is currently in the replay cache
   */
  public isSignatureSeen(signature: string): boolean {
    return this.seenSignatures.has(signature);
  }

  /**
   * Returns current replay cache size (useful for audit/metrics)
   */
  public getReplayCacheSize(): number {
    return this.seenSignatures.size;
  }

  /**
   * Parses the raw HTTP Signature header or Authorization: Signature ***
   */
  public parseSignatureHeader(headerValue: string): ParsedHttpSignature | null {
    let clean = headerValue.trim();
    if (clean.startsWith('Signature ')) {
      clean = clean.slice(10).trim();
    }

    const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
    const params: Record<string, string> = {};
    let match: RegExpExecArray | null;

    while ((match = regex.exec(clean)) !== null) {
      params[match[1]] = match[2];
    }

    if (!params.keyId || !params.signature) {
      return null;
    }

    const headersList = params.headers
      ? params.headers.toLowerCase().split(/\s+/)
      : ['date'];

    return {
      keyId: params.keyId,
      algorithm: (params.algorithm || 'rsa-sha256').toLowerCase(),
      headers: headersList,
      signature: params.signature,
    };
  }

  /**
   * Resolves remote public key PEM, leveraging DB cache or SSRF-safe signed remote fetch
   */
  public async resolvePublicKey(keyId: string): Promise<{ publicKeyPem: string; actorUri: string } | null> {
    const actorUri = keyId.split('#')[0];

    // 1. Check local DB cache
    const cachedActor = await prisma.federatedActor.findFirst({
      where: {
        OR: [{ publicKeyId: keyId }, { uri: actorUri }],
      },
    });

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (cachedActor && cachedActor.publicKeyPem && cachedActor.lastFetchedAt > oneDayAgo) {
      return {
        publicKeyPem: cachedActor.publicKeyPem,
        actorUri: cachedActor.uri,
      };
    }

    // 2. Validate SSRF on keyId
    const allowTesting =
      process.env.NODE_ENV === 'test' ||
      process.env.ALLOW_HTTP_FEDERATION === 'true';

    const ssrfCheck = await ssrfProtectionGuardService.isSafeUrl(keyId, {
      allowPrivateForTesting: allowTesting,
    });
    if (!ssrfCheck.safe) {
      throw new Error(`SSRF_BLOCKED: Unsafe keyId resolution URL (${ssrfCheck.error})`);
    }

    // 3. Fetch remote key using instance actor signature and safe fetch
    try {
      const instanceKey = await activityPubKeyManagerService.getOrCreateInstanceKey();
      const signedHeaders = httpSignatureSignerService.signGetRequest({
        keyId: instanceKey.keyId,
        privateKeyPem: instanceKey.privateKeyPem,
        targetUrl: keyId,
      });

      const response = await ssrfProtectionGuardService.safeFederatedFetch(keyId, {
        method: 'GET',
        headers: signedHeaders as any,
        timeoutMs: 5000,
        maxResponseSizeBytes: 1024 * 1024, // 1MB limit for Actor document to prevent OOM
        allowPrivateForTesting: allowTesting,
      });

      if (!response.ok) {
        throw new Error(`Remote key fetch failed with HTTP ${response.status}`);
      }

      const body = await response.json();
      let publicKeyPem: string | null = null;
      let resolvedActorUri = actorUri;
      let inboxUrl = '';
      let sharedInboxUrl: string | null = null;
      let username = 'remote';
      let domain = new URL(actorUri).hostname;
      let name: string | null = null;
      let summary: string | null = null;
      let avatarUrl: string | null = null;

      if (body.publicKey && typeof body.publicKey === 'object') {
        publicKeyPem = body.publicKey.publicKeyPem;
        resolvedActorUri = body.id || actorUri;
        inboxUrl = body.inbox || '';
        sharedInboxUrl = body.endpoints?.sharedInbox || body.sharedInbox || null;
        const rawUsername = body.preferredUsername || username;
        username = sanitizeFederatedHtml(rawUsername).replace(/[<>'"/\\&`$]/g, '').trim() || 'remote';
        name = body.name ? sanitizeFederatedHtml(body.name).trim() : null;
        summary = body.summary ? sanitizeFederatedHtml(body.summary).trim() : null;
        avatarUrl = body.icon?.url || null;
      } else if (body.publicKeyPem) {
        publicKeyPem = body.publicKeyPem;
        resolvedActorUri = body.owner || actorUri;
      }

      if (!publicKeyPem) {
        throw new Error('No publicKeyPem found in remote Actor JSON-LD document');
      }

      // Upsert into federated_actors
      await prisma.federatedActor.upsert({
        where: { uri: resolvedActorUri },
        create: {
          uri: resolvedActorUri,
          username,
          domain,
          name,
          summary,
          avatarUrl,
          inboxUrl: inboxUrl || `https://${domain}/inbox`,
          sharedInboxUrl,
          publicKeyPem,
          publicKeyId: keyId,
          lastFetchedAt: new Date(),
        },
        update: {
          publicKeyPem,
          publicKeyId: keyId,
          inboxUrl: inboxUrl || undefined,
          sharedInboxUrl: sharedInboxUrl || undefined,
          lastFetchedAt: new Date(),
        },
      });

      return {
        publicKeyPem,
        actorUri: resolvedActorUri,
      };
    } catch (err: any) {
      if (cachedActor && cachedActor.publicKeyPem) {
        // Fallback to stale cache if remote unreachable
        return {
          publicKeyPem: cachedActor.publicKeyPem,
          actorUri: cachedActor.uri,
        };
      }
      throw err;
    }
  }

  /**
   * Main verification entry point for inbound Fastify requests
   */
  public async verifyInboundRequest(
    request: FastifyRequest,
    options: HttpSignatureVerifyOptions = {}
  ): Promise<HttpSignatureVerifyResult> {
    const clockSkewToleranceMs = options.clockSkewToleranceMs ?? 300_000; // 5 minutes default
    const requireDigest = options.requireDigest ?? (request.method === 'POST' || request.method === 'PUT');

    // 1. Locate Signature header
    const rawSigHeader =
      (request.headers['signature'] as string | undefined) ||
      (request.headers['authorization'] as string | undefined);

    if (!rawSigHeader) {
      return { valid: false, keyId: '', actorUri: '', error: 'MISSING_SIGNATURE_HEADER' };
    }

    const parsed = this.parseSignatureHeader(rawSigHeader);
    if (!parsed) {
      return { valid: false, keyId: '', actorUri: '', error: 'MALFORMED_SIGNATURE_HEADER' };
    }

    // 2. Replay attack detection
    if (this.seenSignatures.has(parsed.signature)) {
      return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'REPLAY_ATTACK_DETECTED' };
    }

    // 3. Verify Date & Clock Skew
    const dateHeader = request.headers['date'] as string | undefined;
    if (!dateHeader) {
      return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'MISSING_DATE_HEADER' };
    }

    const requestTimestamp = new Date(dateHeader).getTime();
    if (
      isNaN(requestTimestamp) ||
      isNaN(Date.parse(dateHeader)) ||
      dateHeader.toLowerCase().includes('invalid') ||
      requestTimestamp > 253402300799000
    ) {
      return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'INVALID_DATE_HEADER' };
    }

    const now = Date.now();
    const skew = now - requestTimestamp;

    if (skew > clockSkewToleranceMs) {
      return {
        valid: false,
        keyId: parsed.keyId,
        actorUri: '',
        error: `CLOCK_SKEW_EXCEEDED: Skew was ${skew}ms in the past (allowed: ${clockSkewToleranceMs}ms)`,
      };
    }

    // Asymmetric future-date protection: reject timestamps more than 30s in the future
    if (skew < -30_000) {
      return {
        valid: false,
        keyId: parsed.keyId,
        actorUri: '',
        error: `CLOCK_SKEW_EXCEEDED: Request timestamp was ${Math.abs(skew)}ms in the future (max allowed: 30000ms)`,
      };
    }

    // 4. Verify Digest Header
    if (requireDigest) {
      const digestHeader = request.headers['digest'] as string | undefined;
      if (!digestHeader) {
        return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'MISSING_DIGEST_HEADER' };
      }

      const match = /^SHA-256=(.+)$/i.exec(digestHeader.trim());
      if (!match) {
        return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'UNSUPPORTED_DIGEST_ALGORITHM' };
      }

      const receivedDigest = match[1].trim();

      // Retrieve raw body buffer
      const rawBody =
        (request as any).rawBody ||
        (typeof request.body === 'string'
          ? Buffer.from(request.body, 'utf-8')
          : Buffer.from(JSON.stringify(request.body || {}), 'utf-8'));

      const calculatedDigest = crypto.createHash('sha256').update(rawBody).digest('base64');

      try {
        const bufA = Buffer.from(receivedDigest, 'base64');
        const bufB = Buffer.from(calculatedDigest, 'base64');
        if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
          return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'DIGEST_MISMATCH' };
        }
      } catch {
        return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'DIGEST_VERIFICATION_FAILED' };
      }
    }

    // 5. Enforce Mandatory Signed Headers (Prevent Header Stripping & Payload Substitution)
    const requiredHeaders = requireDigest
      ? ['(request-target)', 'host', 'date', 'digest']
      : ['(request-target)', 'host', 'date'];

    for (const reqHeader of requiredHeaders) {
      if (!parsed.headers.includes(reqHeader)) {
        return {
          valid: false,
          keyId: parsed.keyId,
          actorUri: '',
          error: `MISSING_REQUIRED_SIGNED_HEADER: Signature must sign '${reqHeader}'`,
        };
      }
    }

    // 6. Resolve Public Key
    let resolvedKey: { publicKeyPem: string; actorUri: string };
    try {
      const result = await this.resolvePublicKey(parsed.keyId);
      if (!result) {
        return { valid: false, keyId: parsed.keyId, actorUri: '', error: 'PUBLIC_KEY_NOT_FOUND' };
      }
      resolvedKey = result;
    } catch (err: any) {
      return {
        valid: false,
        keyId: parsed.keyId,
        actorUri: '',
        error: `KEY_RESOLUTION_ERROR: ${err.message}`,
      };
    }

    // 7. Construct Signing String
    const signingLines: string[] = [];
    for (const headerName of parsed.headers) {
      if (headerName === '(request-target)') {
        signingLines.push(`(request-target): ${request.method.toLowerCase()} ${request.url}`);
      } else {
        const val = request.headers[headerName];
        if (val === undefined) {
          return {
            valid: false,
            keyId: parsed.keyId,
            actorUri: resolvedKey.actorUri,
            error: `MISSING_HEADER_IN_REQUEST: Header '${headerName}' listed in Signature was not sent`,
          };
        }
        signingLines.push(`${headerName}: ${Array.isArray(val) ? val.join(', ') : val}`);
      }
    }

    const signingString = signingLines.join('\n');

    // 8. Verify RSA signature
    try {
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(signingString);
      const isSignatureValid = verifier.verify(
        resolvedKey.publicKeyPem,
        parsed.signature,
        'base64'
      );

      if (!isSignatureValid) {
        return {
          valid: false,
          keyId: parsed.keyId,
          actorUri: resolvedKey.actorUri,
          error: 'SIGNATURE_INVALID',
        };
      }

      // Mark signature in bounded replay cache
      this.recordSignature(parsed.signature, Date.now());

      return {
        valid: true,
        keyId: parsed.keyId,
        actorUri: resolvedKey.actorUri,
      };
    } catch (err: any) {
      return {
        valid: false,
        keyId: parsed.keyId,
        actorUri: resolvedKey.actorUri,
        error: `CRYPTO_VERIFY_ERROR: ${err.message}`,
      };
    }
  }
}

export const httpSignatureVerifierService = new HttpSignatureVerifierService();
