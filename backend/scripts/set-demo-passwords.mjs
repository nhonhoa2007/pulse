#!/usr/bin/env node
/**
 * SEC-02: Đặt passwordHash cho 4 tài khoản demo đã tồn tại trong DB local
 * (idempotent, KHÔNG xoá dữ liệu — khác với seed.mjs).
 *
 * Demo User Switcher ở frontend giờ đăng nhập thật qua /auth/login,
 * nên các user demo cũ (tạo trước SEC-02, không có password) cần được cập nhật.
 *
 * Usage: node scripts/set-demo-passwords.mjs
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'PulseDemo2026!';

const DEMO_USERNAMES = ['hoa_dev', 'alice', 'bob', 'sontungmtp'];

const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

const result = await prisma.user.updateMany({
  where: { username: { in: DEMO_USERNAMES }, isRemote: false },
  data: { passwordHash: hash },
});

console.log(`Đã cập nhật passwordHash cho ${result.count}/${DEMO_USERNAMES.length} tài khoản demo.`);
console.log('Mật khẩu demo (dev-only):', DEMO_PASSWORD);
await prisma.$disconnect();
