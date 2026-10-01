import crypto from 'crypto';
import { HttpSignatureSignOptions } from '../../contracts/ActivityPubContracts.js';

export interface SignedHeadersResult {
  Host: string;
  Date: string;
  Digest?: string;
  Signature: string;
  'Content-Type'?: string;
  Accept: string;
  [key: string]: string | undefined;
}

export class HttpSignatureSignerService {
  /**
   * Signs an outbound HTTP request using RSA-SHA256 (draft-cavage-12).
   */
  public signRequest(options: HttpSignatureSignOptions): {
    signatureHeader: string;
    dateHeader: string;
    digestHeader?: string;
  } {
    const { keyId, privateKeyPem, method, targetPath, host, body } = options;
    const dateHeader = options.date || new Date().toUTCString();

    const headersList: string[] = ['(request-target)', 'host', 'date'];
    const lines: string[] = [
      `(request-target): ${method.toLowerCase()} ${targetPath}`,
      `host: ${host}`,
      `date: ${dateHeader}`,
    ];

    let digestHeader: string | undefined;
    if (body !== undefined && body !== null) {
      const digestBase64 = crypto
        .createHash('sha256')
        .update(Buffer.from(body, 'utf-8'))
        .digest('base64');
      digestHeader = `SHA-256=${digestBase64}`;
      headersList.push('digest');
      lines.push(`digest: ${digestHeader}`);
    }

    const signingString = lines.join('\n');

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingString);
    const signatureBase64 = signer.sign(privateKeyPem, 'base64');

    const signatureHeader = `keyId="${keyId}",algorithm="rsa-sha256",headers="${headersList.join(' ')}",signature="${signatureBase64}"`;

    return {
      signatureHeader,
      dateHeader,
      digestHeader,
    };
  }

  /**
   * Convenient helper to generate complete headers for an outbound POST request
   */
  public signPostRequest(params: {
    keyId: string;
    privateKeyPem: string;
    targetUrl: string;
    payload: string;
    date?: string;
  }): SignedHeadersResult {
    const parsed = new URL(params.targetUrl);
    const targetPath = parsed.pathname + (parsed.search || '');
    const host = parsed.host;

    const { signatureHeader, dateHeader, digestHeader } = this.signRequest({
      keyId: params.keyId,
      privateKeyPem: params.privateKeyPem,
      method: 'POST',
      targetPath,
      host,
      body: params.payload,
      date: params.date,
    });

    return {
      Host: host,
      Date: dateHeader,
      Digest: digestHeader!,
      Signature: signatureHeader,
      'Content-Type': 'application/activity+json',
      Accept: 'application/activity+json, application/ld+json',
    };
  }

  /**
   * Convenient helper to generate complete headers for an outbound GET request (e.g. key fetching)
   */
  public signGetRequest(params: {
    keyId: string;
    privateKeyPem: string;
    targetUrl: string;
    date?: string;
  }): SignedHeadersResult {
    const parsed = new URL(params.targetUrl);
    const targetPath = parsed.pathname + (parsed.search || '');
    const host = parsed.host;

    const { signatureHeader, dateHeader } = this.signRequest({
      keyId: params.keyId,
      privateKeyPem: params.privateKeyPem,
      method: 'GET',
      targetPath,
      host,
      date: params.date,
    });

    return {
      Host: host,
      Date: dateHeader,
      Signature: signatureHeader,
      Accept: 'application/activity+json, application/ld+json',
    };
  }
}

export const httpSignatureSignerService = new HttpSignatureSignerService();
