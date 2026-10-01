/**
 * Utility functions for Fediverse handle detection, parsing, formatting, and bio sanitization.
 */

// Regex matching @user@domain or user@domain with optional port
export const FEDIVERSE_HANDLE_REGEX = /^@?([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?)$/;

// Regex matching ActivityPub actor URI (https://...)
export const FEDIVERSE_URL_REGEX = /^https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?)\/(?:users\/|actors\/|accounts\/|@)?([a-zA-Z0-9._-]+)(?:\/.*)?$/i;

// Broader regex matching any HTTPS URL targeting fediverse profile/actor
export const GENERAL_FEDIVERSE_URL_REGEX = /^https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?)\/.*$/i;

export interface ParsedFediverseIdentifier {
  raw: string;
  isFediverse: boolean;
  type: 'handle' | 'url';
  username?: string;
  domain?: string;
  normalizedHandle: string; // e.g. "@user@domain.com" or original URL
}

/**
 * Parses user input to identify if it matches a Fediverse handle or ActivityPub URL.
 */
export function parseFediverseIdentifier(query: string): ParsedFediverseIdentifier | null {
  if (!query) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  // 1. Check handle pattern: @user@domain or user@domain
  const handleMatch = trimmed.match(FEDIVERSE_HANDLE_REGEX);
  if (handleMatch) {
    const [, user, domain] = handleMatch;
    return {
      raw: trimmed,
      isFediverse: true,
      type: 'handle',
      username: user,
      domain: domain.toLowerCase(),
      normalizedHandle: `@${user}@${domain.toLowerCase()}`,
    };
  }

  // 2. Check specific ActivityPub URL pattern: https://domain/users/alice or https://domain/@alice
  const apUrlMatch = trimmed.match(FEDIVERSE_URL_REGEX);
  if (apUrlMatch) {
    const [, domain, user] = apUrlMatch;
    return {
      raw: trimmed,
      isFediverse: true,
      type: 'url',
      username: user,
      domain: domain.toLowerCase(),
      normalizedHandle: trimmed,
    };
  }

  // 3. General Fediverse HTTPS URL pattern
  const generalUrlMatch = trimmed.match(GENERAL_FEDIVERSE_URL_REGEX);
  if (generalUrlMatch) {
    const [, domain] = generalUrlMatch;
    return {
      raw: trimmed,
      isFediverse: true,
      type: 'url',
      domain: domain.toLowerCase(),
      normalizedHandle: trimmed,
    };
  }

  return null;
}

/**
 * Formats a clean Fediverse handle string @user@domain from available properties.
 */
export function formatFediverseHandle(
  username?: string | null,
  domain?: string | null
): string {
  if (!username && !domain) return '';

  const cleanDomain = (domain || '').trim().toLowerCase();
  const rawUser = (username || '').trim();

  // If already formatted like @user@domain
  if (rawUser.includes('@')) {
    const parts = rawUser.replace(/^@/, '').split('@');
    if (parts.length >= 2) {
      return `@${parts[0]}@${(parts[1] || cleanDomain).toLowerCase()}`;
    }
  }

  // If username is generated shadow username like alice_mastodon_social_a1b2
  if (cleanDomain && rawUser.includes('_')) {
    const cleanDomainSlug = cleanDomain.replace(/[^a-zA-Z0-9]/g, '_');
    if (rawUser.includes(`_${cleanDomainSlug}_`)) {
      const preferred = rawUser.split(`_${cleanDomainSlug}_`)[0];
      if (preferred) {
        return `@${preferred}@${cleanDomain}`;
      }
    }
  }

  if (cleanDomain) {
    return `@${rawUser.replace(/^@/, '')}@${cleanDomain}`;
  }

  return `@${rawUser.replace(/^@/, '')}`;
}

/**
 * Sanitizes federated bio/summary text to ensure pure, safe plain text free of HTML and XSS payloads.
 */
export function sanitizeFederatedBio(rawBio?: string | null): string {
  if (!rawBio) return '';

  // Replace <br>, <br/>, </p> with single whitespace or newline
  let text = rawBio
    .replace(/<br\s*[\/]?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<\/div>/gi, ' ');

  // Recursively remove all HTML tags: <script...>, <img...>, <a...>, etc.
  text = text.replace(/<[^>]*>?/gm, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse multiple whitespaces
  text = text.replace(/\s{2,}/g, ' ').trim();

  return text;
}

export interface FederatedCardVisualState {
  displayName: string;
  fediverseHandle: string;
  domain: string;
  hasAvatar: boolean;
  avatarUrl: string | null;
  cleanBio: string;
  hasFediverseBadge: boolean;
  isFollowing: boolean;
  followButtonLabel: string;
  followButtonClass: string;
  followersCount: number;
  followingCount: number;
  actorUri: string | null;
}

/**
 * Computes the complete visual state for FederatedUserCard given a user or actor.
 */
export function getFederatedCardVisualState(
  user?: any,
  actor?: any,
  isFollowingOverride?: boolean
): FederatedCardVisualState {
  const displayName =
    user?.displayName || actor?.displayName || actor?.username || 'Fediverse User';
  const domain = user?.domain || actor?.domain || '';
  const rawUsername =
    actor?.username ||
    (user?.domain && user?.username.includes('_')
      ? user.username.split('_')[0]
      : user?.username) ||
    '';
  const fediverseHandle = formatFediverseHandle(rawUsername, domain);
  const avatarUrl = user?.avatarUrl || actor?.avatarUrl || null;
  const cleanBio = sanitizeFederatedBio(user?.bio || actor?.bio);
  const isFollowing =
    isFollowingOverride !== undefined
      ? isFollowingOverride
      : !!(user?.isFollowing ?? actor?.isFollowing);

  const followButtonLabel = isFollowing ? 'Đang theo dõi' : 'Theo dõi';
  const followButtonClass = isFollowing
    ? 'border border-cloud bg-paper text-ink hover:bg-mist hover:border-ash'
    : 'bg-ink hover:bg-ink/85 text-paper border border-transparent';

  return {
    displayName,
    fediverseHandle,
    domain,
    hasAvatar: !!avatarUrl,
    avatarUrl,
    cleanBio,
    hasFediverseBadge: true,
    isFollowing,
    followButtonLabel,
    followButtonClass,
    followersCount: user?.followersCount ?? 0,
    followingCount: user?.followingCount ?? 0,
    actorUri: user?.actorUri || actor?.actorUri || null,
  };
}

export interface FediverseBannerVisualState {
  shouldShowBanner: boolean;
  targetHandle: string | null;
  bannerTitle: string;
  buttonLabel: string;
  isLoading: boolean;
  hasError: boolean;
  errorMessage: string | null;
}

/**
 * Computes the visual state for the Fediverse remote discovery suggestion banner.
 */
export function getFediverseBannerVisualState(
  query: string,
  isResolving: boolean,
  error: string | null
): FediverseBannerVisualState {
  const target = parseFediverseIdentifier(query);
  if (!target) {
    return {
      shouldShowBanner: false,
      targetHandle: null,
      bannerTitle: '',
      buttonLabel: 'Khám phá từ xa',
      isLoading: false,
      hasError: false,
      errorMessage: null,
    };
  }

  return {
    shouldShowBanner: true,
    targetHandle: target.normalizedHandle,
    bannerTitle: `Khám phá tài khoản từ xa trên Fediverse: ${target.normalizedHandle}`,
    buttonLabel: isResolving ? 'Đang tìm...' : 'Khám phá từ xa',
    isLoading: isResolving,
    hasError: !!error,
    errorMessage: error,
  };
}

