/**
 * PKG-01: Card xem trước link (OpenGraph) trong bài viết.
 * Fetch qua GET /api/v1/link-preview (SSRF-guarded, cache 24h phía server).
 */
import React, { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../api/PulseApiClient';

interface LinkPreviewData {
  url: string;
  domain: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
  themeColor: string | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;

/** Trích URL đầu tiên trong nội dung bài viết. */
export function extractFirstUrl(content: string | undefined | null): string | null {
  if (!content) return null;
  const match = content.match(URL_IN_TEXT);
  return match ? match[0] : null;
}

export const LinkPreviewCard: React.FC<{ content: string | undefined | null }> = ({ content }) => {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const url = extractFirstUrl(content);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState('loading');
    api
      .getLinkPreview(url)
      .then((data) => {
        if (!cancelled) {
          setPreview(data || null);
          setState('done');
        }
      })
      .catch(() => {
        if (!cancelled) setState('done');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!url || state !== 'done' || !preview) {
    return null;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      data-testid="link-preview-card"
      className="block mt-2 border border-cloud rounded-[14px] overflow-hidden hover:bg-mist/50 transition-colors"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt={preview.title}
          className="w-full max-h-[280px] object-cover"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="px-3 py-2.5">
        <p className="text-[12px] text-ash uppercase tracking-wide truncate">
          {preview.siteName || preview.domain}
        </p>
        <p className="text-[14px] font-semibold text-ink leading-snug line-clamp-2">{preview.title}</p>
        {preview.description && (
          <p className="text-[13px] text-graphite leading-snug line-clamp-2 mt-0.5">{preview.description}</p>
        )}
        <span className="inline-flex items-center gap-1 text-[12px] text-meta mt-1">
          <ExternalLink className="w-3 h-3" />
          {preview.domain}
        </span>
      </div>
    </a>
  );
};
