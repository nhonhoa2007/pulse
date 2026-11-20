import { expect, test, type Page } from '@playwright/test';

const user = {
  id: 'user-e2e',
  username: 'pulse_tester',
  displayName: 'Pulse Tester',
  avatarUrl: null,
  bio: 'Browser test account',
  isCelebrity: false,
  followersCount: 3,
  followingCount: 2,
  postsCount: 25,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makePost(index: number) {
  return {
    id: `post-${index}`,
    authorId: user.id,
    content: `Bài viết kiểm thử số ${index} #pulse`,
    mediaUrls: [],
    replyToId: null,
    rootPostId: null,
    repostOfId: null,
    quoteOfId: null,
    likesCount: index,
    repliesCount: 0,
    repostsCount: 0,
    quotesCount: 0,
    viewsCount: index * 10,
    hashtags: ['pulse'],
    mentions: [],
    createdAt: new Date(Date.UTC(2026, 0, 30, 0, 0, index)).toISOString(),
    author: user,
  };
}

async function mockApi(
  page: Page,
  initialRefreshMode: 'valid' | 'expired' | 'network' = 'valid',
  initialFeedMode: 'ok' | 'error' = 'ok',
) {
  let ticketCount = 0;
  let refreshMode = initialRefreshMode;
  let feedMode = initialFeedMode;
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status >= 400
        ? { success: false, error: data }
        : { success: true, data }),
    });

    if (path.endsWith('/auth/refresh')) {
      if (refreshMode === 'network') return route.abort('failed');
      if (refreshMode === 'expired') {
        return json({ code: 'INVALID_REFRESH_TOKEN', message: 'Phiên đã hết hạn' }, 401);
      }
      return json({ accessToken: 'e2e-token', user });
    }
    if (path.endsWith('/auth/login')) return json({ token: 'login-token', user });
    if (path.endsWith('/realtime/ticket')) {
      ticketCount += 1;
      return json({ ticket: `ticket-${ticketCount}`, expiresIn: 30 });
    }
    if (path.endsWith('/realtime/stream')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache' },
        body: `event: CONNECTED\ndata: {"ok":true}\n\n`,
      });
    }
    if (
      path.endsWith('/feed/for-you') ||
      path.endsWith('/feed/home') ||
      path.endsWith('/feed/explore') ||
      path.includes('/feed/user/')
    ) {
      if (feedMode === 'error') {
        return json({ code: 'FEED_UNAVAILABLE', message: 'Bảng tin tạm thời gián đoạn' }, 503);
      }
      const cursor = url.searchParams.get('cursor');
      return cursor
        ? json({ posts: Array.from({ length: 5 }, (_, i) => makePost(i + 21)), nextCursor: null })
        : json({ posts: Array.from({ length: 20 }, (_, i) => makePost(i + 1)), nextCursor: 'page-2' });
    }
    if (path.endsWith('/trending')) return json({ trending: [{ tag: 'pulse', postsCount: 25, score: 12.5 }] });
    if (path.endsWith('/notifications')) return json({ notifications: [] });
    if (path.endsWith('/dm/conversations')) return json({ conversations: [], nextCursor: null });
    if (path.endsWith('/users/follow-requests')) return json({ requests: [] });
    if (path.endsWith(`/users/${user.username}`)) return json(user);
    if (path.endsWith('/posts/views')) return json({ recorded: 0, buffered: 0 });
    return json({});
  });
  return {
    getTicketCount: () => ticketCount,
    setRefreshMode: (mode: 'valid' | 'expired' | 'network') => {
      refreshMode = mode;
    },
    setFeedMode: (mode: 'ok' | 'error') => {
      feedMode = mode;
    },
  };
}

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await mockApi(page);
});

test('responsive feed, infinite scroll, share link, theme and keyboard dialog', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trang chủ' })).toBeVisible();
  await expect(page.locator('[data-post-id]')).toHaveCount(20);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-post-id]')).toHaveCount(25);
  await expect(page.locator('[data-post-id="post-21"]')).toHaveCount(1);

  await page.locator('[data-post-id="post-1"]').getByTitle('Chia sẻ liên kết').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('http://127.0.0.1:4173/post/post-1');

  const composeButton = page.getByRole('button', { name: /Đăng bài mới|Tạo bài viết/ }).first();
  await composeButton.focus();
  await composeButton.click();
  const dialog = page.getByRole('dialog', { name: 'Bài viết mới' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(composeButton).toBeFocused();

  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  if ((page.viewportSize()?.width ?? 0) < 600) {
    await expect(page.getByText('Trang cá nhân', { exact: true })).toBeVisible();
  }
  await page.getByTestId('theme-switcher-trigger').click();
  await page.getByTestId('theme-option-dark').click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('single realtime transport obtains a fresh ticket after disconnect', async ({ page }) => {
  let tickets = 0;
  await page.on('request', (request) => {
    if (request.url().includes('/realtime/ticket')) tickets += 1;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trang chủ' })).toBeVisible();
  await expect.poll(() => tickets, { timeout: 5_000 }).toBeGreaterThanOrEqual(2);
});

test('following, explore and profile all load subsequent cursor pages', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-following').click();
  await expect(page.locator('[data-post-id]')).toHaveCount(20);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-post-id]')).toHaveCount(25);

  await page.goto('/explore');
  await expect(page.getByText('Khám phá các chủ đề thịnh hành hôm nay')).toBeVisible();
  await expect(page.locator('[data-post-id]')).toHaveCount(20);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-post-id]')).toHaveCount(25);

  await page.goto(`/@${user.username}`);
  await expect(page.getByRole('heading', { level: 1, name: user.displayName })).toBeVisible();
  await expect(page.locator('[data-post-id]')).toHaveCount(20);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-post-id]')).toHaveCount(25);
});

test('expired refresh cookie falls back to login and authenticates with real form flow', async ({ page }) => {
  await page.unroute('**/api/v1/**');
  await mockApi(page, 'expired');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trang chủ' })).toBeVisible();

  const desktopLogin = page.getByRole('button', { name: 'Đăng nhập', exact: true }).first();
  if (await desktopLogin.isVisible()) {
    await desktopLogin.click();
  } else {
    await page.getByRole('button', { name: 'Menu tài khoản' }).click();
    await page.getByRole('button', { name: 'Đăng nhập / Đăng ký' }).click();
  }

  const dialog = page.getByRole('dialog', { name: 'Đăng nhập vào Pulse' });
  await dialog.getByLabel(/Tên đăng nhập hoặc Email/i).fill('pulse_tester');
  await dialog.getByLabel('Mật khẩu').fill('secret-password');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Đăng nhập thành công/)).toBeVisible();
});

test('network failure during session restore is distinct and retryable', async ({ page }) => {
  await page.unroute('**/api/v1/**');
  const control = await mockApi(page, 'network');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chưa thể khôi phục phiên' })).toBeVisible();
  control.setRefreshMode('valid');
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByRole('heading', { name: 'Trang chủ' })).toBeVisible();
});

test('feed server failure has a retry action that recovers the page', async ({ page }) => {
  await page.unroute('**/api/v1/**');
  const control = await mockApi(page, 'valid', 'error');
  await page.goto('/');
  await expect(page.getByText('Không thể tải bài viết')).toBeVisible();
  control.setFeedMode('ok');
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('[data-post-id]')).toHaveCount(20);
});

test('service worker presents an explicit offline page', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const cachedUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const requests = await Promise.all(keys.map(async (key) => caches.open(key).then((cache) => cache.keys())));
    return requests.flat().map((request) => request.url);
  });
  expect(cachedUrls.some((url) => url.includes('/api/') || url.includes('/dm/'))).toBe(false);
  await context.setOffline(true);
  try {
    await page.goto('/offline-check');
    await expect(page.getByRole('heading', { name: 'Bạn đang ngoại tuyến' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
