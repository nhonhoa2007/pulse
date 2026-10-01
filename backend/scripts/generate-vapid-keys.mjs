#!/usr/bin/env node
/**
 * SEC-04: Sinh cặp khóa VAPID (RFC 8292, NIST P-256) cho Web Push và in ra
 * giá trị base64 một dòng để dán vào backend/.env.
 *
 * Persist keypair qua ENV là bắt buộc: nếu sinh lại mỗi lần restart,
 * mọi subscription push đã đăng ký sẽ mất hiệu lực (orphan subscriptions).
 *
 * Usage: node scripts/generate-vapid-keys.mjs
 */
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const encode = (pem) => Buffer.from(pem, 'utf8').toString('base64');

console.log('Thêm các dòng sau vào backend/.env:\n');
console.log(`VAPID_PUBLIC_KEY=${encode(publicKey)}`);
console.log(`VAPID_PRIVATE_KEY=${encode(privateKey)}`);
console.log(`VAPID_SUBJECT=mailto:admin@pulse.social`);
console.log('\nLưu ý: giá trị là base64 của PEM; server chấp nhận cả PEM đầy đủ hoặc base64 một dòng.');
