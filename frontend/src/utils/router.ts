/**
 * PKG-08: URL ⇄ View mapping cho deep linking.
 *
 * Bảng route:
 *   /                              → home
 *   /explore                       → explore
 *   /notifications                 → notifications
 *   /messages                      → messages
 *   /messages/:conversationId      → messages
 *   /@:username                    → profile (?tab=posts|replies|bookmarks)
 *   /post/:id                      → thread
 *
 * Backward-compat: URL cũ dạng /?view=profile&username=abc&tab=posts được
 * nhận diện và chuyển thành path sạch (replaceState).
 */
// PKG-08: type definitions đặt tại đây (nguồn duy nhất) — PulseContext
// re-export lại để giữ tương thích với các import hiện có.
export type ViewType = 'home' | 'explore' | 'notifications' | 'profile' | 'thread' | 'messages';

export interface ViewParams {
  postId?: string;
  username?: string;
  hashtag?: string;
  tab?: string;
  conversationId?: string;
  recipientId?: string;
  groupId?: string;
}

export interface RouteLocation {
  view: ViewType;
  params: ViewParams;
  path: string;
}

const VIEWS: ViewType[] = ['home', 'explore', 'notifications', 'profile', 'thread', 'messages'];

/** View + params → path chuẩn (dùng cho pushState). */
export function viewToPath(view: ViewType, params: ViewParams = {}): string {
  switch (view) {
    case 'explore':
      return '/explore';
    case 'notifications':
      return '/notifications';
    case 'messages':
      return params.conversationId ? `/messages/${encodeURIComponent(params.conversationId)}` : '/messages';
    case 'profile': {
      if (!params.username) return '/';
      const query = params.tab ? `?tab=${encodeURIComponent(params.tab)}` : '';
      return `/@${encodeURIComponent(params.username)}${query}`;
    }
    case 'thread':
      return params.postId ? `/post/${encodeURIComponent(params.postId)}` : '/';
    case 'home':
    default:
      return '/';
  }
}

/** Path + query hiện tại → view/params. Trả về null nếu không nhận diện được. */
export function parsePath(pathname: string, search = ''): RouteLocation | null {
  const query = new URLSearchParams(search || '');
  const path = (pathname || '/').replace(/\/+$/, '') || '/';

  // Legacy query-param URLs: /?view=profile&username=abc
  const legacyView = query.get('view') as ViewType | null;
  if (legacyView && VIEWS.includes(legacyView)) {
    const params: ViewParams = {
      postId: query.get('postId') || undefined,
      username: query.get('username') || undefined,
      hashtag: query.get('hashtag') || undefined,
      tab: query.get('tab') || undefined,
      conversationId: query.get('conversationId') || undefined,
      recipientId: query.get('recipientId') || undefined,
      groupId: query.get('groupId') || undefined,
    };
    return { view: legacyView, params, path: viewToPath(legacyView, params) };
  }

  if (path === '/' || path === '') {
    return { view: 'home', params: {}, path: '/' };
  }
  if (path === '/explore') {
    return { view: 'explore', params: {}, path };
  }
  if (path === '/notifications') {
    return { view: 'notifications', params: {}, path };
  }
  if (path === '/messages') {
    return { view: 'messages', params: {}, path };
  }
  const messagesMatch = path.match(/^\/messages\/([^/]+)$/);
  if (messagesMatch) {
    return { view: 'messages', params: { conversationId: decodeURIComponent(messagesMatch[1]) }, path };
  }
  const profileMatch = path.match(/^\/@([^/]+)$/);
  if (profileMatch) {
    const username = decodeURIComponent(profileMatch[1]);
    const tab = query.get('tab') || undefined;
    return { view: 'profile', params: tab ? { username, tab } : { username }, path };
  }
  const threadMatch = path.match(/^\/post\/([^/]+)$/);
  if (threadMatch) {
    return { view: 'thread', params: { postId: decodeURIComponent(threadMatch[1]) }, path };
  }
  return null;
}

/** URL query params cũ có cần chuyển đổi sang path sạch không. */
export function isLegacyQueryUrl(search: string): boolean {
  if (!search) return false;
  const query = new URLSearchParams(search);
  return query.has('view');
}
