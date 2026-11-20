import React, { useEffect, useState } from 'react';
import { api } from '../api/PulseApiClient';

interface ProtectedMediaProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  allowExternal?: boolean;
}

export const ProtectedMedia: React.FC<ProtectedMediaProps> = ({
  src,
  alt,
  className,
  allowExternal = true,
  onClick,
  ...imageProps
}) => {
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null);
  const [externalEnabled, setExternalEnabled] = useState(false);
  let localFileUrl: URL | null = null;
  try {
    const candidate = new URL(src, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
    if (/^\/uploads\/[a-f0-9-]{36}\.(?:webp|jpg|png|gif)$/.test(candidate.pathname)) localFileUrl = candidate;
  } catch { /* External or malformed image URL. */ }
  const isLocalUpload = localFileUrl !== null;
  const token = api.getToken();

  useEffect(() => {
    if (!localFileUrl) return;
    let active = true;
    let createdUrl: string | null = null;
    const imageEndpoint = typeof window === 'undefined'
      ? null
      : `${window.location.origin}/api/v1${localFileUrl.pathname}`;
    if (!imageEndpoint) return;
    void fetch(imageEndpoint, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
    }).then(async (response) => {
      if (!response.ok) return;
      createdUrl = URL.createObjectURL(await response.blob());
      if (active) setLoaded({ src, url: createdUrl });
    }).catch(() => undefined);
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, isLocalUpload, token]);

  if (!isLocalUpload && !allowExternal && !externalEnabled) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => setExternalEnabled(true)}
        aria-label="Tải ảnh từ máy chủ bên ngoài"
      >
        Tải ảnh bên ngoài
      </button>
    );
  }

  return (
    <img
      src={isLocalUpload ? (loaded?.src === src ? loaded.url : undefined) : src}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onClick={onClick}
      {...imageProps}
    />
  );
};
