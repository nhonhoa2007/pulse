import type { FeedPage, RecordPostViewsResponse } from '../../types/PulseTypes';

type Request = <T>(endpoint: string, options?: RequestInit) => Promise<T>;

export class FeedApi {
  private readonly request: Request;

  constructor(request: Request) {
    this.request = request;
  }

  private normalizePage(response: unknown): FeedPage {
    if (Array.isArray(response)) return { posts: response, nextCursor: null };
    const value = response as any;
    const posts = Array.isArray(value?.posts)
      ? value.posts
      : Array.isArray(value?.items)
      ? value.items
      : [];
    return {
      posts,
      nextCursor: typeof value?.nextCursor === 'string' ? value.nextCursor : null,
      ...(typeof value?.isLocked === 'boolean' ? { isLocked: value.isLocked } : {}),
    };
  }

  private pageQuery(cursor?: string, limit = 20): string {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    return params.size ? `?${params.toString()}` : '';
  }

  async getHome(cursor?: string, limit = 20): Promise<FeedPage> {
    return this.normalizePage(await this.request(`/feed/home${this.pageQuery(cursor, limit)}`));
  }

  async getForYou(cursor?: string, limit = 20): Promise<FeedPage> {
    return this.normalizePage(await this.request(`/feed/for-you${this.pageQuery(cursor, limit)}`));
  }

  async getExplore(cursor?: string, limit = 20): Promise<FeedPage> {
    return this.normalizePage(await this.request(`/feed/explore${this.pageQuery(cursor, limit)}`));
  }

  async getUser(username: string, cursor?: string, limit = 20): Promise<FeedPage> {
    const path = `/feed/user/${encodeURIComponent(username)}${this.pageQuery(cursor, limit)}`;
    return this.normalizePage(await this.request(path));
  }

  async recordViews(postIds: string[]): Promise<RecordPostViewsResponse> {
    if (postIds.length === 0) return { recorded: 0, buffered: 0 };
    return this.request('/posts/views', {
      method: 'POST',
      body: JSON.stringify({ postIds }),
    });
  }
}
