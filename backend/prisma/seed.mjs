import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial data for Pulse Microblogging...');

  // Xoá sạch dữ liệu cũ theo đúng thứ tự ràng buộc khóa ngoại
  await prisma.user.updateMany({ data: { pinnedPostId: null, federatedActorId: null } });
  await prisma.timelineInbox.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.like.deleteMany({});
  await prisma.repost.deleteMany({});
  await prisma.bookmark.deleteMany({});
  await prisma.pollVote.deleteMany({});
  await prisma.pollChoice.deleteMany({});
  await prisma.poll.deleteMany({});
  await prisma.postVersion.deleteMany({});
  await prisma.activityDeliveryJob.deleteMany({});
  await prisma.groupReadReceipt.deleteMany({});
  await prisma.groupMessage.deleteMany({});
  await prisma.groupMember.deleteMany({});
  await prisma.groupConversation.deleteMany({});
  await prisma.dmReadReceipt.deleteMany({});
  await prisma.dmMessage.deleteMany({});
  await prisma.dmConversation.deleteMany({});
  await prisma.webPushSubscription.deleteMany({});
  await prisma.followRequest.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.revokedToken.deleteMany({});
  await prisma.keywordMute.deleteMany({});
  await prisma.userMute.deleteMany({});
  await prisma.federatedFollow.deleteMany({});
  await prisma.federatedActor.deleteMany({});
  await prisma.federationKey.deleteMany({});
  await prisma.hashtag.deleteMany({});
  await prisma.post.deleteMany({});
  await prisma.block.deleteMany({});
  await prisma.follow.deleteMany({});
  await prisma.user.deleteMany({});

  // 1. Tạo Users mẫu
  const hoa = await prisma.user.create({
    data: {
      username: 'hoa_dev',
      email: 'hoa@pulse.local',
      displayName: 'Hoà Phùng',
      bio: 'Arch Linux & Backend Enthusiast | Building high-concurrency systems 🚀',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      isCelebrity: false,
    },
  });

  const alice = await prisma.user.create({
    data: {
      username: 'alice',
      email: 'alice@pulse.local',
      displayName: 'Alice Nguyễn',
      bio: 'Frontend Specialist & UX Lover 🎨',
      avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
      isCelebrity: false,
    },
  });

  const bob = await prisma.user.create({
    data: {
      username: 'bob',
      email: 'bob@pulse.local',
      displayName: 'Bob Trần',
      bio: 'Distributed Systems & Database nerd 💾',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
      isCelebrity: false,
    },
  });

  const sontung = await prisma.user.create({
    data: {
      username: 'sontungmtp',
      email: 'sontung@pulse.local',
      displayName: 'Sơn Tùng M-TP',
      bio: 'Official Pulse Account | Sky ơi 🎶',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
      isCelebrity: true, // VIP KOL -> Fan-out on Read
      followersCount: 5000000,
    },
  });

  // 2. Thiết lập Quan hệ Follow
  // Hoà follow Alice, Bob, và Sơn Tùng
  await prisma.follow.createMany({
    data: [
      { followerId: hoa.id, followingId: alice.id },
      { followerId: hoa.id, followingId: bob.id },
      { followerId: hoa.id, followingId: sontung.id },
      { followerId: alice.id, followingId: hoa.id },
      { followerId: bob.id, followingId: hoa.id },
    ],
  });

  await prisma.user.update({
    where: { id: hoa.id },
    data: { followingCount: 3, followersCount: 2 },
  });

  await prisma.user.update({
    where: { id: alice.id },
    data: { followingCount: 1, followersCount: 1 },
  });

  await prisma.user.update({
    where: { id: bob.id },
    data: { followingCount: 1, followersCount: 1 },
  });

  // 3. Tạo một số bài viết khởi đầu
  // Alice đăng bài (User thường -> đẩy vào inbox của Hoà)
  const post1 = await prisma.post.create({
    data: {
      authorId: alice.id,
      content: 'Chào mừng mọi người đến với Pulse! Kiến trúc Microblogging mới siêu mượt #tech #pulse',
      hashtags: ['tech', 'pulse'],
      likesCount: 1,
    },
  });

  // Hoà nhận bài vào timeline inbox
  await prisma.timelineInbox.create({
    data: {
      userId: hoa.id,
      postId: post1.id,
      authorId: alice.id,
    },
  });

  // Sơn Tùng đăng bài (KOL -> KHÔNG fan-out inbox, chỉ đọc qua Fan-out on Read)
  await prisma.post.create({
    data: {
      authorId: sontung.id,
      content: 'Một ngày thật tuyệt vời cùng các bạn Sky! Hẹn gặp tối nay nhé ✨ #Sky #Concert',
      hashtags: ['Sky', 'Concert'],
      likesCount: 12500,
      repostsCount: 3400,
    },
  });

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
