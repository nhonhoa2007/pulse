/**
 * Central secrets resolution with fail-fast semantics (IMPROVEMENT_PLAN_V2 / SEC-03, SEC-04).
 *
 * Secrets MUST be provided via the process environment (backend/.env for local runs,
 * injected environment for CI/production). No hardcoded fallback values are permitted:
 * a process missing a mandatory secret must refuse to boot instead of silently running
 * with a publicly-known key.
 */

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(
      `Missing required environment secret: ${name}. ` +
        `Set it in backend/.env or the process environment (see .env.example).`
    );
    this.name = 'MissingSecretError';
  }
}

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new MissingSecretError(name);
  }
  return value.trim();
}

export function getJwtSecret(): string {
  return requireSecret('JWT_SECRET');
}

export function getCookieSecret(): string {
  return requireSecret('COOKIE_SECRET');
}

/**
 * VAPID (RFC 8292) P-256 keypair used for Web Push.
 * Values may be raw PEM (with BEGIN/END lines) or single-line base64 of the PEM.
 */
export function getVapidKeyPair(): { publicKey: string; privateKey: string } {
  const publicKey = requireSecret('VAPID_PUBLIC_KEY');
  const privateKey = requireSecret('VAPID_PRIVATE_KEY');
  return { publicKey, privateKey };
}

export function getVapidSubject(): string {
  return process.env.VAPID_SUBJECT || 'mailto:admin@pulse.social';
}
