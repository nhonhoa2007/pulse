import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface SsrfCheckResult {
  safe: boolean;
  error?: string;
  ip?: string;
}

export interface SsrfCheckOptions {
  allowPrivateForTesting?: boolean;
}

export interface SafeFetchRequestOptions {
  method?: string;
  headers?: Record<string, string | undefined> | any;
  body?: string | Buffer;
  timeoutMs?: number;
  maxResponseSizeBytes?: number;
  maxRedirects?: number;
  allowPrivateForTesting?: boolean;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json: <T = any>() => Promise<T>;
  text: () => Promise<string>;
}

export class SsrfProtectionGuardService {
  /**
   * Convert an IPv4 string to an unsigned 32-bit integer.
   */
  private ipV4ToNumber(ip: string): number {
    return ip
      .split('.')
      .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
  }

  /**
   * Checks if an IPv4 address belongs to private, loopback, link-local, or reserved blocks.
   */
  public isPrivateIpv4(ip: string): boolean {
    const num = this.ipV4ToNumber(ip);

    // 0.0.0.0/8 (Current network)
    if ((num >>> 24) === 0) return true;

    // 10.0.0.0/8 (RFC 1918 Private)
    if ((num >>> 24) === 10) return true;

    // 100.64.0.0/10 (Shared Address Space / CGNAT)
    if ((num >>> 22) === 0x191) return true;

    // 127.0.0.0/8 (Loopback)
    if ((num >>> 24) === 127) return true;

    // 169.254.0.0/16 (Link-Local, AWS Metadata 169.254.169.254)
    if ((num >>> 16) === 0xa9fe) return true;

    // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
    if ((num >>> 20) === 0xac1) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if ((num >>> 8) === 0xc00000) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if ((num >>> 8) === 0xc00002) return true;

    // 192.88.99.0/24 (6to4 Relay Anycast)
    if ((num >>> 8) === 0xc05863) return true;

    // 192.168.0.0/16 (RFC 1918 Private)
    if ((num >>> 16) === 0xc0a8) return true;

    // 198.18.0.0/15 (Benchmarking RFC 2544: 198.18.0.0 - 198.19.255.255)
    if ((num >>> 17) === 0x6309) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if ((num >>> 8) === 0xc63364) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if ((num >>> 8) === 0xcb0071) return true;

    // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved (224-255)
    if ((num >>> 28) >= 14) return true;

    // 255.255.255.255 (Broadcast)
    if (num === 0xffffffff) return true;

    return false;
  }

  /**
   * Checks if an IPv6 address belongs to loopback, link-local, unique local, or mapped addresses.
   */
  public isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();

    // Loopback & unspecified
    if (normalized === '::1' || normalized === '::') return true;

    // IPv4-mapped IPv6 (::ffff:x.x.x.x) or SIIT (::ffff:0:x.x.x.x)
    if (normalized.startsWith('::ffff:')) {
      const parts = normalized.split(':');
      const lastPart = parts[parts.length - 1];
      if (net.isIPv4(lastPart)) {
        return this.isPrivateIpv4(lastPart);
      }
    }

    // IPv4-compatible IPv6 (::x.x.x.x)
    if (normalized.startsWith('::') && normalized.includes('.') && net.isIPv4(normalized.slice(2))) {
      return this.isPrivateIpv4(normalized.slice(2));
    }

    // 6to4 tunneling (2002::/16) - embeds IPv4 in 2nd and 3rd 16-bit words
    if (normalized.startsWith('2002:')) {
      const segments = normalized.split(':');
      if (segments.length >= 3 && segments[1] && segments[2]) {
        try {
          const octet1 = parseInt(segments[1].slice(0, 2), 16);
          const octet2 = parseInt(segments[1].slice(2, 4), 16);
          const octet3 = parseInt(segments[2].slice(0, 2), 16);
          const octet4 = parseInt(segments[2].slice(2, 4), 16);
          const embeddedIp = `${octet1}.${octet2}.${octet3}.${octet4}`;
          if (net.isIPv4(embeddedIp) && this.isPrivateIpv4(embeddedIp)) {
            return true;
          }
        } catch {
          return true;
        }
      }
    }

    // Link-local (fe80::/10)
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true;
    }

    // Unique Local Address (fc00::/7 -> fc.. or fd..)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }

    // Documentation prefix (2001:db8::/32)
    if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0db8:')) {
      return true;
    }

    // Discard prefix (100::/64)
    if (normalized.startsWith('100::')) {
      return true;
    }

    return false;
  }

  /**
   * Checks if an IP is private (either v4 or v6).
   */
  public isPrivateIp(ip: string): boolean {
    const cleanIp = ip.replace(/^\[|\]$/g, '').trim();
    if (net.isIPv4(cleanIp)) {
      return this.isPrivateIpv4(cleanIp);
    }
    if (net.isIPv6(cleanIp)) {
      return this.isPrivateIpv6(cleanIp);
    }
    return true; // Malformed IP treated as unsafe
  }

  /**
   * Validate a target URL for SSRF vulnerabilities before any outbound HTTP request.
   */
  public async isSafeUrl(
    targetUrl: string,
    options: SsrfCheckOptions = {}
  ): Promise<SsrfCheckResult> {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { safe: false, error: 'INVALID_URL: Failed to parse URL structure' };
    }

    const allowTesting =
      options.allowPrivateForTesting ??
      (process.env.ALLOW_HTTP_FEDERATION === 'true' || process.env.NODE_ENV === 'test');

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { safe: false, error: `UNSUPPORTED_PROTOCOL: Protocol ${parsed.protocol} not allowed` };
    }

    if (parsed.protocol === 'http:' && !allowTesting) {
      return { safe: false, error: 'INSECURE_PROTOCOL: HTTPS required in production environment' };
    }

    // Clean bracketed IPv6 hostnames
    const rawHostname = parsed.hostname;
    const hostname = rawHostname.replace(/^\[|\]$/g, '').trim();

    // Port validation to prevent port scanning / protocol smuggling
    if (parsed.port) {
      const portNum = parseInt(parsed.port, 10);
      if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
        return { safe: false, error: `INVALID_PORT: Port ${parsed.port} is outside valid range (1-65535)` };
      }

      // Prohibited internal services
      const dangerousPorts = [
        21, 22, 23, 25, 53, 69, 110, 119, 123, 135, 137, 138, 139, 143, 161, 389, 445,
        5432, 6379, 8086, 9200, 11211, 27017, 28017,
      ];
      if (dangerousPorts.includes(portNum)) {
        return { safe: false, error: `FORBIDDEN_PORT: Port ${portNum} is blocked to prevent protocol smuggling` };
      }

      // In production, only standard web ports allowed
      if (!allowTesting && portNum !== 80 && portNum !== 443) {
        return { safe: false, error: `FORBIDDEN_PORT: Federation traffic in production restricted to 80/443 (got ${portNum})` };
      }
    }

    // Direct check if hostname is literal IP
    if (net.isIP(hostname)) {
      if (this.isPrivateIp(hostname) && !allowTesting) {
        return { safe: false, error: `SSRF_BLOCKED: Destination IP ${hostname} is private or reserved`, ip: hostname };
      }
      return { safe: true, ip: hostname };
    }

    // Check against localhost alias
    if (hostname.toLowerCase() === 'localhost') {
      if (!allowTesting) {
        return { safe: false, error: 'SSRF_BLOCKED: Localhost domain is prohibited in production federation' };
      }
      return { safe: true, ip: '127.0.0.1' };
    }

    // DNS Resolution to detect DNS Rebinding and resolve host
    try {
      const addresses = await dns.promises.lookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        return { safe: false, error: `DNS_RESOLUTION_FAILED: No IP address resolved for ${hostname}` };
      }

      for (const entry of addresses) {
        if (this.isPrivateIp(entry.address) && !allowTesting) {
          return {
            safe: false,
            error: `SSRF_BLOCKED: Hostname ${hostname} resolved to private/reserved IP ${entry.address}`,
            ip: entry.address,
          };
        }
      }

      return { safe: true, ip: addresses[0].address };
    } catch (err: any) {
      return {
        safe: false,
        error: `DNS_LOOKUP_ERROR: Failed to resolve ${hostname} (${err?.message || 'unknown error'})`,
      };
    }
  }

  /**
   * Performs an SSRF-safe HTTP/HTTPS request with:
   * 1. Target URL validation
   * 2. DNS rebinding prevention (custom lookup verifying IP at connection time)
   * 3. Redirect validation (each hop re-checked for SSRF)
   * 4. Strict response size limits (prevent OOM bombs)
   * 5. Socket timeout enforcement
   */
  public async safeFederatedFetch(
    targetUrl: string,
    options: SafeFetchRequestOptions = {},
    redirectCount = 0
  ): Promise<SafeFetchResponse> {
    const maxRedirects = options.maxRedirects ?? 3;
    const timeoutMs = options.timeoutMs ?? 5000;
    const maxResponseSizeBytes = options.maxResponseSizeBytes ?? 1024 * 1024; // 1MB default
    const allowTesting =
      options.allowPrivateForTesting ??
      (process.env.ALLOW_HTTP_FEDERATION === 'true' || process.env.NODE_ENV === 'test');

    if (redirectCount > maxRedirects) {
      throw new Error(`TOO_MANY_REDIRECTS: Exceeded maximum allowed redirects (${maxRedirects})`);
    }

    // 1. Validate URL SSRF
    const ssrfCheck = await this.isSafeUrl(targetUrl, {
      allowPrivateForTesting: allowTesting,
    });
    if (!ssrfCheck.safe) {
      throw new Error(`SSRF_BLOCKED: ${ssrfCheck.error}`);
    }

    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const method = (options.method || 'GET').toUpperCase();
    const headers: Record<string, string> = {};

    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((val, key) => {
          headers[key] = val;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [k, v] of options.headers) {
          headers[k] = v;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const cleanHost = parsed.hostname.replace(/^\[|\]$/g, '').trim();

    return new Promise<SafeFetchResponse>((resolve, reject) => {
      let isSettled = false;

      const safeReject = (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      };

      const requestOptions: http.RequestOptions = {
        protocol: parsed.protocol,
        hostname: cleanHost,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method,
        headers,
        timeout: timeoutMs,
        // Anti-DNS Rebinding: Custom lookup function validates IP address at connection time
        lookup: (lookupHost, lookupOpts, cb) => {
          dns.lookup(lookupHost, lookupOpts, (err, address, family) => {
            if (err) return cb(err, address as any, family);
            const resolvedIp = Array.isArray(address) ? address[0]?.address : address;
            if (resolvedIp && !allowTesting && this.isPrivateIp(String(resolvedIp))) {
              return cb(
                new Error(`SSRF_BLOCKED: DNS resolved to private IP ${resolvedIp} during socket connection`),
                address as any,
                family
              );
            }
            cb(null, address as any, family);
          });
        },
      };

      const req = httpModule.request(requestOptions, async (res) => {
        const statusCode = res.statusCode || 500;
        const statusText = res.statusMessage || '';
        const responseHeaders: Record<string, string> = {};

        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) {
            responseHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }
        }

        // Handle Redirects safely
        if (statusCode >= 300 && statusCode < 400 && responseHeaders['location']) {
          req.destroy();
          try {
            const redirectUrl = new URL(responseHeaders['location'], targetUrl).toString();
            const redirectResponse = await this.safeFederatedFetch(
              redirectUrl,
              options,
              redirectCount + 1
            );
            if (!isSettled) {
              isSettled = true;
              resolve(redirectResponse);
            }
          } catch (err: any) {
            safeReject(err);
          }
          return;
        }

        // Stream and enforce maximum response size to prevent OOM
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxResponseSizeBytes) {
            req.destroy();
            safeReject(
              new Error(
                `RESOURCE_EXHAUSTION: Response exceeded maximum allowable size (${maxResponseSizeBytes} bytes)`
              )
            );
          } else {
            chunks.push(chunk);
          }
        });

        res.on('end', () => {
          if (isSettled) return;
          isSettled = true;

          const rawBuffer = Buffer.concat(chunks);
          const bodyText = rawBuffer.toString('utf-8');

          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            status: statusCode,
            statusText,
            headers: responseHeaders,
            text: async () => bodyText,
            json: async <T = any>() => {
              if (!bodyText.trim()) return {} as T;
              return JSON.parse(bodyText) as T;
            },
          });
        });

        res.on('error', (err) => {
          safeReject(err);
        });
      });

      req.on('timeout', () => {
        req.destroy();
        safeReject(new Error(`REQUEST_TIMEOUT: Outbound federation request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        safeReject(err);
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }
}

export const ssrfProtectionGuardService = new SsrfProtectionGuardService();
