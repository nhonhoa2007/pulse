/**
 * PKG-01: OpenGraph Link Previews.
 *
 *  - GET /api/v1/link-preview?url=... → metadata OG/Twitter Card của URL.
 *  - Tái dùng SsrfProtectionGuardService (chặn loopback/private/metadata).
 *  - Cache in-memory TTL 24h, bounded (LRU-lite qua Map giới hạn kích thước).
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import { ssrfProtectionGuardService } from '../federation/SsrfProtectionGuardService.js';

interface LinkPreviewData {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
  themeColor: string | null;
}

interface CacheEntry {
  data: LinkPreviewData | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX_ENTRIES = 500;
const MAX_HTML_BYTES = 512 * 1024;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractMeta(html: string, propertyNames: string[]): string | null {
  for (const name of propertyNames) {
    // thuộc tính có thể đứng trước hoặc sau content — dùng 2 pattern
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return decodeHtmlEntities(match[1]).trim() || null;
      }
    }
  }
  return null;
}

function resolveImageUrl(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

export class LinkPreviewService {
  private cache: Map<string, CacheEntry> = new Map();

  constructor() {
    this.getPreview = this.getPreview.bind(this);
  }

  private getFromCache(url: string): LinkPreviewData | null | undefined {
    const entry = this.cache.get(url);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(url);
      return undefined;
    }
    return entry.data;
  }

  private putInCache(url: string, data: LinkPreviewData | null): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // xóa entry cũ nhất (chèn đầu Map)
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(url, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  public async fetchPreview(targetUrl: string, allowPrivateForTesting = false): Promise<LinkPreviewData | null> {
    const cached = this.getFromCache(targetUrl);
    if (cached !== undefined) return cached;

    // SSRF guard — tuyệt đối không fetch nội bộ
    const htmlResponse = await ssrfProtectionGuardService.safeFederatedFetch(targetUrl, {
      timeoutMs: 5000,
      maxResponseSizeBytes: MAX_HTML_BYTES,
      maxRedirects: 3,
      allowPrivateForTesting,
    });

    if (!htmlResponse.ok) {
      this.putInCache(targetUrl, null);
      return null;
    }
    const html = await htmlResponse.text();
    if (!html) {
      this.putInCache(targetUrl, null);
      return null;
    }

    try {
      const parsedUrl = new URL(targetUrl);
      const title =
        extractMeta(html, ['og:title', 'twitter:title']) ||
        stripTags(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '') ||
        parsedUrl.hostname;
      const description =
        extractMeta(html, ['og:description', 'twitter:description', 'description']) || '';
      const image = resolveImageUrl(extractMeta(html, ['og:image', 'twitter:image', 'twitter:image:src']), targetUrl);
      const siteName = extractMeta(html, ['og:site_name', 'application-name']) || parsedUrl.hostname;
      const themeColor = extractMeta(html, ['theme-color', 'msapplication-TileColor']);

      const data: LinkPreviewData = {
        url: targetUrl,
        domain: parsedUrl.hostname,
        title: title.slice(0, 300),
        description: description.slice(0, 500),
        image,
        siteName: siteName.slice(0, 100),
        themeColor,
      };
      this.putInCache(targetUrl, data);
      return data;
    } catch {
      this.putInCache(targetUrl, null);
      return null;
    }
  }

  /**
   * Fastify handler GET /api/v1/link-preview?url=...
   */
  public async getPreview(req: FastifyRequest<{ Querystring: { url?: string } }>, reply: FastifyReply): Promise<unknown> {
    const currentUserId = (req as unknown as { currentUserId?: string | null }).currentUserId;
    if (!currentUserId) {
      reply.status(401);
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
    }

    const raw = (req.query.url || '').trim();
    if (!raw) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'INVALID_URL', message: 'Tham số url là bắt buộc' },
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      reply.status(400);
      return {
        success: false,
        error: { code: 'INVALID_URL', message: 'URL không hợp lệ' },
      };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reply.status(400);
      return {
        success: false,
        error: { code: 'INVALID_URL', message: 'Chỉ hỗ trợ http/https' },
      };
    }

    try {
      // PKG-01: strict SSRF check trước mọi fetch. Mặc định chặn cả private/loopback
      // (kể cả trong test); chỉ env LINK_PREVIEW_ALLOW_PRIVATE_MOCK=1 + NODE_ENV=test
      // mở khóa để mock server local chạy được — production không bao giờ set.
      const allowPrivate =
        process.env.NODE_ENV === 'test' && process.env.LINK_PREVIEW_ALLOW_PRIVATE_MOCK === '1';
      const strictCheck = await ssrfProtectionGuardService.isSafeUrl(raw, {
        allowPrivateForTesting: allowPrivate,
      });
      if (!strictCheck.safe) {
        reply.status(400);
        return {
          success: false,
          error: { code: 'SSRF_BLOCKED', message: 'URL bị chặn vì lý do bảo mật' },
        };
      }

      const data = await this.fetchPreview(raw, allowPrivate);
      if (!data) {
        return {
          success: true,
          data: null,
        };
      }
      return { success: true, data };
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.startsWith('SSRF_BLOCKED')) {
        reply.status(400);
        return {
          success: false,
          error: { code: 'SSRF_BLOCKED', message: 'URL bị chặn vì lý do bảo mật' },
        };
      }
      // Lỗi mạng/timeout → trả null nhẹ nhàng, frontend ẩn card
      return { success: true, data: null };
    }
  }

  /** Test hook: xóa cache */
  public clearCache(): void {
    this.cache.clear();
  }
}

export const linkPreviewService = new LinkPreviewService();
