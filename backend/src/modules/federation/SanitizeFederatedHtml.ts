/**
 * Innermost-first recursive HTML sanitizer for federated payloads.
 * Neutralizes Stored XSS vectors (script, iframe, object, embed, event handlers, javascript: URIs)
 * across bio, summary, displayName, and post contents from external Fediverse actors.
 */
export function sanitizeFederatedHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let sanitized = rawHtml;
  let previous = '';
  let passes = 0;

  // Innermost-first recursive loop to defeat nested evasion tags (e.g. <scr<script>ipt> or <<script>script>)
  while (sanitized !== previous && passes < 15) {
    previous = sanitized;
    passes++;
    sanitized = sanitized
      // Neutralize script tags (paired, self-closing, unclosed, or orphaned)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<script\b[^>]*\/?>/gi, '')
      .replace(/<\/script>/gi, '')
      // Neutralize active content and plugin tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<iframe\b[^>]*\/?>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<object\b[^>]*\/?>/gi, '')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
      .replace(/<embed\b[^>]*\/?>/gi, '')
      .replace(/<applet\b[^<]*(?:(?!<\/applet>)<[^<]*)*<\/applet>/gi, '')
      .replace(/<applet\b[^>]*\/?>/gi, '')
      .replace(/<meta\b[^>]*\/?>/gi, '')
      .replace(/<base\b[^>]*\/?>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<style\b[^>]*\/?>/gi, '')
      .replace(/<link\b[^>]*\/?>/gi, '')
      .replace(/<form\b[^>]*\/?>/gi, '')
      .replace(/<\/form>/gi, '')
      // Neutralize event handlers: on* attributes delimited by whitespace, quotes, slashes, or start of tag
      .replace(/[\s/]+on\w+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '')
      // Neutralize javascript:, vbscript:, data: URIs in href and src
      .replace(/href\s*=\s*(["'][^"']*(?:javascript|vbscript|data):[^"']*["']|(?:javascript|vbscript|data):[^\s>]+)/gi, 'href="#"')
      .replace(/src\s*=\s*(["'][^"']*(?:javascript|vbscript|data):[^"']*["']|(?:javascript|vbscript|data):[^\s>]+)/gi, 'src=""');
  }

  return sanitized.trim();
}
