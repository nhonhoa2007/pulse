import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFediverseIdentifier,
  formatFediverseHandle,
  sanitizeFederatedBio,
  getFederatedCardVisualState,
  getFediverseBannerVisualState,
} from '../src/utils/federatedUtils.ts';

describe('TASK-19: Frontend Visual States & Remote Fediverse Discovery Test Suite', () => {
  // -------------------------------------------------------------------------
  // 1. Fediverse Handle & URL Parsing (parseFediverseIdentifier)
  // -------------------------------------------------------------------------
  describe('1. Fediverse Handle & URL Parsing (parseFediverseIdentifier)', () => {
    it('parses standard @user@domain handle correctly', () => {
      const result = parseFediverseIdentifier('@alice@mastodon.social');
      assert.notEqual(result, null);
      assert.equal(result.isFediverse, true);
      assert.equal(result.type, 'handle');
      assert.equal(result.username, 'alice');
      assert.equal(result.domain, 'mastodon.social');
      assert.equal(result.normalizedHandle, '@alice@mastodon.social');
    });

    it('parses user@domain handle without leading @ symbol', () => {
      const result = parseFediverseIdentifier('alice@threads.net');
      assert.notEqual(result, null);
      assert.equal(result.isFediverse, true);
      assert.equal(result.type, 'handle');
      assert.equal(result.username, 'alice');
      assert.equal(result.domain, 'threads.net');
      assert.equal(result.normalizedHandle, '@alice@threads.net');
    });

    it('parses handle with special characters like dots, dashes, and underscores', () => {
      const result = parseFediverseIdentifier('@john.doe_99-dev@sub.instance.org');
      assert.notEqual(result, null);
      assert.equal(result.username, 'john.doe_99-dev');
      assert.equal(result.domain, 'sub.instance.org');
      assert.equal(result.normalizedHandle, '@john.doe_99-dev@sub.instance.org');
    });

    it('parses handle with custom port in domain', () => {
      const result = parseFediverseIdentifier('@charlie@federated-test.local:8443');
      assert.notEqual(result, null);
      assert.equal(result.username, 'charlie');
      assert.equal(result.domain, 'federated-test.local:8443');
      assert.equal(result.normalizedHandle, '@charlie@federated-test.local:8443');
    });

    it('parses standard ActivityPub Actor URL (https://domain/users/alice)', () => {
      const url = 'https://mastodon.social/users/alice';
      const result = parseFediverseIdentifier(url);
      assert.notEqual(result, null);
      assert.equal(result.isFediverse, true);
      assert.equal(result.type, 'url');
      assert.equal(result.username, 'alice');
      assert.equal(result.domain, 'mastodon.social');
      assert.equal(result.normalizedHandle, url);
    });

    it('parses Threads/Mastodon profile URL (https://threads.net/@zuck)', () => {
      const url = 'https://threads.net/@zuck';
      const result = parseFediverseIdentifier(url);
      assert.notEqual(result, null);
      assert.equal(result.isFediverse, true);
      assert.equal(result.type, 'url');
      assert.equal(result.username, 'zuck');
      assert.equal(result.domain, 'threads.net');
      assert.equal(result.normalizedHandle, url);
    });

    it('returns null for local user mention without domain (@bob)', () => {
      assert.equal(parseFediverseIdentifier('@bob'), null);
      assert.equal(parseFediverseIdentifier('@hoa_dev'), null);
    });

    it('returns null for hashtags (#tech, #fediverse)', () => {
      assert.equal(parseFediverseIdentifier('#tech'), null);
      assert.equal(parseFediverseIdentifier('#fediverse'), null);
    });

    it('returns null for plain search text', () => {
      assert.equal(parseFediverseIdentifier('distributed systems'), null);
      assert.equal(parseFediverseIdentifier('pulse microblogging'), null);
    });

    it('returns null for empty string or whitespace', () => {
      assert.equal(parseFediverseIdentifier(''), null);
      assert.equal(parseFediverseIdentifier('   '), null);
      assert.equal(parseFediverseIdentifier(null), null);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Fediverse Handle Formatting (formatFediverseHandle)
  // -------------------------------------------------------------------------
  describe('2. Fediverse Handle Formatting (formatFediverseHandle)', () => {
    it('formats plain username and domain into @user@domain', () => {
      const handle = formatFediverseHandle('alice', 'mastodon.social');
      assert.equal(handle, '@alice@mastodon.social');
    });

    it('strips redundant leading @ from username', () => {
      const handle = formatFediverseHandle('@bob', 'pixelfed.social');
      assert.equal(handle, '@bob@pixelfed.social');
    });

    it('extracts preferred username from shadow user slug (cleanUser_cleanDomain_suffix)', () => {
      const handle = formatFediverseHandle(
        'alice_mastodon_social_7a8b',
        'mastodon.social'
      );
      assert.equal(handle, '@alice@mastodon.social');
    });

    it('preserves existing well-formed @user@domain string', () => {
      const handle = formatFediverseHandle('@carol@lemmy.world', 'lemmy.world');
      assert.equal(handle, '@carol@lemmy.world');
    });

    it('converts domain to lowercase consistently', () => {
      const handle = formatFediverseHandle('alice', 'Mastodon.Social');
      assert.equal(handle, '@alice@mastodon.social');
    });

    it('handles empty properties safely', () => {
      assert.equal(formatFediverseHandle('', ''), '');
      assert.equal(formatFediverseHandle(null, null), '');
      assert.equal(formatFediverseHandle('dan', ''), '@dan');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Stored XSS Neutralization & Bio Sanitization (sanitizeFederatedBio)
  // -------------------------------------------------------------------------
  describe('3. Stored XSS Neutralization & Bio Sanitization (sanitizeFederatedBio)', () => {
    it('strips <script> tags and malicious payloads completely', () => {
      const malicious = 'Hello <script>alert("XSS")</script> World!';
      const clean = sanitizeFederatedBio(malicious);
      assert.equal(clean.includes('<script>'), false);
      assert.equal(clean.includes('</script>'), false);
      assert.equal(clean, 'Hello alert("XSS") World!');
    });

    it('strips <img onerror="..."> execution vectors', () => {
      const payload = 'Look at this: <img src="x" onerror="document.location=\'//evil.com\'"> Cool right?';
      const clean = sanitizeFederatedBio(payload);
      assert.equal(clean.includes('<img'), false);
      assert.equal(clean.includes('onerror'), false);
      assert.equal(clean, 'Look at this: Cool right?');
    });

    it('replaces <p> and <br> tags with proper whitespace', () => {
      const html = '<p>First line</p><br/><p>Second line</p>';
      const clean = sanitizeFederatedBio(html);
      assert.equal(clean, 'First line Second line');
    });

    it('decodes HTML entities (&amp;, &lt;, &gt;, &quot;, &#39;, &nbsp;)', () => {
      const encoded = 'Decentralized &amp; open &lt;web&gt; with &quot;Fediverse&quot; &amp; fun!';
      const clean = sanitizeFederatedBio(encoded);
      assert.equal(clean, 'Decentralized & open <web> with "Fediverse" & fun!');
    });

    it('collapses multiple consecutive whitespace characters into a single space', () => {
      const dirty = 'Lots   of    spaced   \n\n\t   words';
      const clean = sanitizeFederatedBio(dirty);
      assert.equal(clean, 'Lots of spaced words');
    });

    it('handles empty, null, or undefined bio safely without throwing', () => {
      assert.equal(sanitizeFederatedBio(null), '');
      assert.equal(sanitizeFederatedBio(undefined), '');
      assert.equal(sanitizeFederatedBio(''), '');
    });
  });

  // -------------------------------------------------------------------------
  // 4. FederatedUserCard Visual States & Invariants
  // -------------------------------------------------------------------------
  describe('4. FederatedUserCard Visual States & Invariants', () => {
    it('evaluates not-following visual state correctly', () => {
      const user = {
        id: 'u-101',
        username: 'alice_mastodon_social_123',
        displayName: 'Alice In Fediverse',
        avatarUrl: 'https://mastodon.social/avatars/alice.png',
        bio: 'Building decentralized futures',
        isCelebrity: false,
        followersCount: 420,
        followingCount: 115,
        postsCount: 50,
        isRemote: true,
        domain: 'mastodon.social',
        actorUri: 'https://mastodon.social/users/alice',
        isFollowing: false,
        createdAt: new Date().toISOString(),
      };

      const state = getFederatedCardVisualState(user, null);
      assert.equal(state.displayName, 'Alice In Fediverse');
      assert.equal(state.fediverseHandle, '@alice@mastodon.social');
      assert.equal(state.domain, 'mastodon.social');
      assert.equal(state.isFollowing, false);
      assert.equal(state.followButtonLabel, 'Theo dõi');
      assert.equal(state.followButtonClass.includes('bg-ink'), true);
      assert.equal(state.hasFediverseBadge, true);
      assert.equal(state.followersCount, 420);
      assert.equal(state.followingCount, 115);
      assert.equal(state.actorUri, 'https://mastodon.social/users/alice');
    });

    it('evaluates following visual state correctly', () => {
      const user = {
        id: 'u-102',
        username: 'bob',
        displayName: 'Bob The Builder',
        avatarUrl: null,
        bio: '<script>alert(1)</script>Bob builds nodes',
        isCelebrity: false,
        followersCount: 15,
        followingCount: 20,
        postsCount: 10,
        isRemote: true,
        domain: 'threads.net',
        actorUri: 'https://threads.net/@bob',
        isFollowing: true,
        createdAt: new Date().toISOString(),
      };

      const state = getFederatedCardVisualState(user, null);
      assert.equal(state.isFollowing, true);
      assert.equal(state.followButtonLabel, 'Đang theo dõi');
      assert.equal(state.followButtonClass.includes('border-cloud'), true);
      assert.equal(state.hasAvatar, false);
      assert.equal(state.cleanBio, 'alert(1)Bob builds nodes');
    });

    it('evaluates RemoteActorDiscoveryResult fallback attributes seamlessly', () => {
      const actor = {
        actorUri: 'https://pixelfed.social/users/carol',
        username: 'carol',
        domain: 'pixelfed.social',
        displayName: 'Carol Photos',
        bio: 'Fediverse photographer',
        avatarUrl: 'https://pixelfed.social/avatar.jpg',
        isRemote: true,
        shadowUserId: 'shadow-carol-456',
        inboxUrl: 'https://pixelfed.social/users/carol/inbox',
        isFollowing: false,
      };

      const state = getFederatedCardVisualState(null, actor);
      assert.equal(state.displayName, 'Carol Photos');
      assert.equal(state.fediverseHandle, '@carol@pixelfed.social');
      assert.equal(state.actorUri, 'https://pixelfed.social/users/carol');
      assert.equal(state.isFollowing, false);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Fediverse Banner Visual States (getFediverseBannerVisualState)
  // -------------------------------------------------------------------------
  describe('5. Fediverse Banner Visual States (getFediverseBannerVisualState)', () => {
    it('returns shouldShowBanner: false when query is not a Fediverse identifier', () => {
      const state = getFediverseBannerVisualState('hello world', false, null);
      assert.equal(state.shouldShowBanner, false);
      assert.equal(state.targetHandle, null);
    });

    it('returns shouldShowBanner: true and formats target handle for Fediverse query', () => {
      const state = getFediverseBannerVisualState('@alice@mastodon.social', false, null);
      assert.equal(state.shouldShowBanner, true);
      assert.equal(state.targetHandle, '@alice@mastodon.social');
      assert.equal(state.buttonLabel, 'Khám phá từ xa');
      assert.equal(state.isLoading, false);
      assert.equal(state.hasError, false);
    });

    it('reflects loading state while remote actor resolution is in flight', () => {
      const state = getFediverseBannerVisualState('@alice@mastodon.social', true, null);
      assert.equal(state.isLoading, true);
      assert.equal(state.buttonLabel, 'Đang tìm...');
    });

    it('reflects error state and error message when remote instance resolution fails', () => {
      const errorMsg = 'Không thể tìm thấy hoặc kết nối tới tài khoản từ xa trên invalid.domain.';
      const state = getFediverseBannerVisualState('@alice@invalid.domain', false, errorMsg);
      assert.equal(state.hasError, true);
      assert.equal(state.errorMessage, errorMsg);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Optimistic UI Follow / Unfollow State Transitions
  // -------------------------------------------------------------------------
  describe('6. Optimistic UI Follow / Unfollow State Transitions', () => {
    it('simulates optimistic follow transition (+1 count, label changes)', () => {
      let currentFollowing = false;
      let followersCount = 100;

      // User clicks Follow
      const nextFollowing = !currentFollowing;
      const nextCount = nextFollowing ? followersCount + 1 : Math.max(0, followersCount - 1);

      currentFollowing = nextFollowing;
      followersCount = nextCount;

      assert.equal(currentFollowing, true);
      assert.equal(followersCount, 101);

      const visual = getFederatedCardVisualState(
        { followersCount },
        null,
        currentFollowing
      );
      assert.equal(visual.isFollowing, true);
      assert.equal(visual.followButtonLabel, 'Đang theo dõi');
      assert.equal(visual.followersCount, 101);
    });

    it('simulates optimistic unfollow transition (-1 count, label changes)', () => {
      let currentFollowing = true;
      let followersCount = 50;

      // User clicks Unfollow
      const nextFollowing = !currentFollowing;
      const nextCount = nextFollowing ? followersCount + 1 : Math.max(0, followersCount - 1);

      currentFollowing = nextFollowing;
      followersCount = nextCount;

      assert.equal(currentFollowing, false);
      assert.equal(followersCount, 49);

      const visual = getFederatedCardVisualState(
        { followersCount },
        null,
        currentFollowing
      );
      assert.equal(visual.isFollowing, false);
      assert.equal(visual.followButtonLabel, 'Theo dõi');
      assert.equal(visual.followersCount, 49);
    });

    it('simulates error rollback reverting back to original state on API failure', () => {
      const initialFollowing = false;
      const initialFollowersCount = 42;

      let currentFollowing = initialFollowing;
      let followersCount = initialFollowersCount;

      // Optimistic update
      currentFollowing = true;
      followersCount = 43;

      // API request fails -> Rollback executed
      const apiFailed = true;
      if (apiFailed) {
        currentFollowing = initialFollowing;
        followersCount = initialFollowersCount;
      }

      assert.equal(currentFollowing, false);
      assert.equal(followersCount, 42);

      const visual = getFederatedCardVisualState(
        { followersCount },
        null,
        currentFollowing
      );
      assert.equal(visual.isFollowing, false);
      assert.equal(visual.followButtonLabel, 'Theo dõi');
    });
  });
});
