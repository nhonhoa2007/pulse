import { prisma } from '../../db/PrismaClientSingleton.js';
import { realtimeStreamController } from '../notifications/RealtimeEventStreamController.js';
import { visiblePostWhere } from '../posts/PostVisibility.js';
import { formatPollDto, type PollWithRelations } from './PollDto.js';

export async function sendPollUpdate(poll: PollWithRelations): Promise<void> {
  if (!poll.postId) return;
  const viewers = realtimeStreamController.getConnectedUserIds();
  if (!viewers.length) return;
  const postId = poll.postId;
  // Group permission reads into bounded queries regardless of connection count.
  for (let offset = 0; offset < viewers.length; offset += 100) {
    const batch = viewers.slice(offset, offset + 100);
    const allowed = await prisma.$transaction(batch.map((viewerId) => prisma.post.count({
      where: { id: postId, ...visiblePostWhere(viewerId) },
    })));
    const viewerVotes = await prisma.pollVote.findMany({
      where: { pollId: poll.id, userId: { in: batch } },
    });
    batch.forEach((viewerId, index) => {
      if (allowed[index]) {
        const userVote = viewerVotes.find((vote) => vote.userId === viewerId);
        realtimeStreamController.sendToUser(viewerId, 'POLL_UPDATED', formatPollDto({
          ...poll,
          votes: userVote ? [userVote] : [],
        }, viewerId));
      }
    });
  }
}
