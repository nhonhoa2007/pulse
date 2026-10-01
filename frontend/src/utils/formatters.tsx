import React from 'react';

/**
 * Format ISO date string into human-friendly relative time (e.g. 5m, 2h, 3d, 12 thg 5)
 */
export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  const now = Date.now();
  const diffInSeconds = Math.floor((now - date.getTime()) / 1000);

  if (diffInSeconds < 30) {
    return 'vừa xong';
  }
  if (diffInSeconds < 60) {
    return `${diffInSeconds}s`;
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays}d`;
  }

  return date.toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Format large numbers to compact notation (e.g., 12500 -> 12.5k, 5000000 -> 5M)
 */
export function formatCount(count: number | undefined | null): string {
  if (count === undefined || count === null || count === 0) {
    return '';
  }
  if (count < 1000) {
    return count.toString();
  }
  if (count < 1000000) {
    const formatted = (count / 1000).toFixed(count < 10000 ? 1 : 0);
    return `${formatted.replace(/\.0$/, '')}k`;
  }
  const formatted = (count / 1000000).toFixed(1);
  return `${formatted.replace(/\.0$/, '')}M`;
}

/**
 * Parse text to highlight hashtags (#tag) and mentions (@username) in Meta Blue #385898
 */
export function renderRichContent(
  text: string,
  onTagClick?: (tag: string) => void,
  onMentionClick?: (username: string) => void
): React.ReactNode[] {
  if (!text) return [];

  // Regex to detect hashtags (#word), mentions (@word), and URLs
  const tokenRegex = /(#[a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]+|@[a-zA-Z0-9_]+|https?:\/\/[^\s]+)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (part.startsWith('#')) {
      const tag = part.slice(1);
      return (
        <span
          key={index}
          onClick={(e) => {
            e.stopPropagation();
            onTagClick?.(tag);
          }}
          className="text-meta hover:underline cursor-pointer font-normal"
        >
          {part}
        </span>
      );
    }

    if (part.startsWith('@')) {
      const username = part.slice(1);
      return (
        <span
          key={index}
          onClick={(e) => {
            e.stopPropagation();
            onMentionClick?.(username);
          }}
          className="text-meta hover:underline cursor-pointer font-normal"
        >
          {part}
        </span>
      );
    }

    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-meta hover:underline break-all"
        >
          {part}
        </a>
      );
    }

    return <span key={index}>{part}</span>;
  });
}
