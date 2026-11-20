import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/PrismaClientSingleton.js';

export function visiblePostWhere(viewerId?: string | null): Prisma.PostWhereInput {
  return {
    isDeleted: false,
    author: {
      isDeleted: false,
      accountStatus: 'ACTIVE',
      ...(viewerId ? {
        blockedUsers: { none: { blockedId: viewerId } },
        blockedBy: { none: { blockerId: viewerId } },
        OR: [
          { id: viewerId },
          { isPrivate: false },
          { followers: { some: { followerId: viewerId } } },
        ],
      } : { isPrivate: false }),
    },
  };
}

export async function visibleQuoteIds(posts: { quoteOfId: string | null }[], viewerId?: string | null): Promise<Set<string>> {
  const ids = [...new Set(posts.flatMap((post) => post.quoteOfId ? [post.quoteOfId] : []))];
  if (!ids.length) return new Set();
  const visible = await prisma.post.findMany({
    where: { id: { in: ids }, ...visiblePostWhere(viewerId) },
    select: { id: true },
  });
  return new Set(visible.map(({ id }) => id));
}
