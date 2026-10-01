/**
 * PKG-11: Full-text search tiếng Việt — tsvector (unaccent) + GIN index.
 *
 * Invariants:
 *  - Multi-word query khớp KHÔNG dấu ("hoa binh thoi tiet" → "Hòa Bình ... thời tiết").
 *  - Query CÓ dấu vẫn khớp bình thường.
 *  - Hashtag search & single-word giữ nguyên hành vi cũ (LIKE path).
 *  - Privacy: bài của private author không xuất hiện với người lạ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { prisma } from '../src/db/PrismaClientSingleton.ts';
import { buildApp } from '../src/app.ts';
import { authHeaders } from './helpers/auth.mjs';

const timestamp = Date.now();
const uniqueMarker = `ftsprobe${crypto.randomBytes(3).toString('hex')}`;

test('PKG-11: full-text search matches Vietnamese with and without diacritics', async () => {
  const app = await buildApp();
  const author = await prisma.user.create({
    data: {
      username: `fts_author_${timestamp}`,
      email: `fts_author_${timestamp}@test.local`,
      displayName: 'FTS Author',
    },
  });

  const uniqueContent = `Dự báo ${uniqueMarker}: Hòa Bình đậm nghiệm thời tiết miền núi phía Bắc`;
  await prisma.post.create({
    data: { authorId: author.id, content: uniqueContent },
  });

  // 1. Query KHÔNG dấu, nhiều từ → khớp qua FTS
  const noDiacritics = await app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent(`du bao hoa binh thoi tiet ${uniqueMarker}`)}&type=posts`,
  });
  assert.equal(noDiacritics.statusCode, 200);
  const hits1 = noDiacritics.json().data?.posts || noDiacritics.json().posts || [];
  assert.ok(
    hits1.some((p) => p.id && p.content && p.content.includes(uniqueMarker)),
    'FTS không dấu phải tìm thấy bài viết có dấu'
  );

  // 2. Query CÓ dấu → vẫn khớp
  const withDiacritics = await app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent(`hòa bình ${uniqueMarker}`)}&type=posts`,
  });
  assert.equal(withDiacritics.statusCode, 200);
  const hits2 = withDiacritics.json().data?.posts || withDiacritics.json().posts || [];
  assert.ok(hits2.some((p) => p.content && p.content.includes(uniqueMarker)), 'FTS có dấu vẫn khớp');

  // 3. Private author: người lạ không thấy bài
  const privateAuthor = await prisma.user.create({
    data: {
      username: `fts_priv_${timestamp}`,
      email: `fts_priv_${timestamp}@test.local`,
      displayName: 'FTS Private',
      isPrivate: true,
    },
  });
  await prisma.post.create({
    data: { authorId: privateAuthor.id, content: `Bí mật ${uniqueMarker} của tài khoản riêng tư` },
  });

  const strangerSearch = await app.inject({
    method: 'GET',
    url: `/api/v1/search?q=${encodeURIComponent(`bí mật ${uniqueMarker}`)}&type=posts`,
  });
  const hits3 = strangerSearch.json().data?.posts || strangerSearch.json().posts || [];
  assert.ok(
    !hits3.some((p) => p.authorId === privateAuthor.id),
    'bài của private author phải bị ẩn với người lạ'
  );

  // 4. Hashtag search giữ hành vi cũ
  await prisma.post.create({
    data: { authorId: author.id, content: `Hashtag test ${uniqueMarker}`, hashtags: ['ftstag'] },
  });
  const hashtagSearch = await app.inject({
    method: 'GET',
    url: `/api/v1/search?q=%23ftstag&type=posts`,
  });
  const hits4 = hashtagSearch.json().data?.posts || hashtagSearch.json().posts || [];
  assert.ok(hits4.some((p) => p.content?.includes('Hashtag test')), 'hashtag search vẫn hoạt động');

  await prisma.user.deleteMany({ where: { id: { in: [author.id, privateAuthor.id] } } });
  await app.close();
});
