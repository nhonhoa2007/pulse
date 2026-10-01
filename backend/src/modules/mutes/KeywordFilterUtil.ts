export interface KeywordMuteRecord {
  id: string;
  keyword: string;
  matchType: 'CONTAINS' | 'EXACT_WORD';
  muteContext: 'ALL' | 'HOME_TIMELINE' | 'NOTIFICATIONS';
  expiresAt: Date | null;
}

/**
 * Escapes regex special characters
 */
export function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Checks if a keyword mute rule is currently active (not expired)
 */
export function isKeywordActive(keywordMute: { expiresAt: Date | null }, now = new Date()): boolean {
  if (!keywordMute.expiresAt) {
    return true;
  }
  return keywordMute.expiresAt.getTime() > now.getTime();
}

/**
 * Checks if given text or hashtags match a keyword mute rule
 */
export function matchesKeyword(
  content: string,
  hashtags: string[],
  keyword: string,
  matchType: 'CONTAINS' | 'EXACT_WORD'
): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return false;

  const normalizedContent = content.toLowerCase();

  if (matchType === 'CONTAINS') {
    if (normalizedContent.includes(normalizedKeyword)) {
      return true;
    }
    for (const tag of hashtags) {
      if (tag.toLowerCase().includes(normalizedKeyword)) {
        return true;
      }
    }
    return false;
  }

  if (matchType === 'EXACT_WORD') {
    // Unicode-aware word boundary matching for phrases and words
    const escaped = escapeRegex(normalizedKeyword);
    const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:[^\\p{L}\\p{N}_]|$)`, 'iu');
    if (regex.test(normalizedContent)) {
      return true;
    }
    for (const tag of hashtags) {
      const lowerTag = tag.toLowerCase();
      if (lowerTag === normalizedKeyword || lowerTag === `#${normalizedKeyword}`) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Tests whether a post matches ANY of the provided active keyword mutes
 */
export function postMatchesKeywords(
  post: { content: string; hashtags: string[] },
  keywordMutes: KeywordMuteRecord[],
  context?: 'HOME_TIMELINE' | 'NOTIFICATIONS'
): boolean {
  const now = new Date();

  for (const km of keywordMutes) {
    if (!isKeywordActive(km, now)) {
      continue;
    }

    if (context && km.muteContext !== 'ALL' && km.muteContext !== context) {
      continue;
    }

    if (matchesKeyword(post.content, post.hashtags, km.keyword, km.matchType)) {
      return true;
    }
  }

  return false;
}
