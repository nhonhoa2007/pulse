/**
 * Test environment preload — nạp bằng `node --import ./tests/setup-env.mjs --test ...`
 * (đã cấu hình trong npm script `test`).
 *
 * Vai trò:
 *  - Cung cấp mandatory secrets để mọi tiến trình test thỏa mãn hợp đồng fail-fast SEC-03/SEC-04.
 *  - Cố định VAPID keypair để chữ ký push ổn định giữa các lần khởi tạo (SEC-04).
 *  - Tắt rate limiting (SEC-05) để các suite gửi hàng trăm request không bị 429;
 *    riêng suite rate-limiting tự bật lại bằng cách set RATE_LIMIT_DISABLED=0 trước buildApp().
 *
 * Giá trị dưới đây CHỈ dùng cho kiểm thử — không bao giờ dùng trong production.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

process.env.JWT_SECRET = 'test-jwt-secret-hardening-week-do-not-use-in-production';
process.env.COOKIE_SECRET = 'test-cookie-secret-hardening-week-do-not-use-in-production';

// Fixed P-256 VAPID keypair (base64 of PEM) — stable across all test processes.
process.env.VAPID_PUBLIC_KEY =
  'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFeE00QXJKV1hqKzZYc25iN2UrMHpDSXErbDlaMAp5RGVPaWF0S2V1b1NmT0Y0RW9EYmk3VnNoQ1hORXNXSDk2RVdGY0l6eVQwRFo0NnVlNnYyQ0RNbGNBPT0KLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==';
process.env.VAPID_PRIVATE_KEY =
  'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ29yOUtReFZka3ErRXJNK2YKdGRNbmt6SVBERE9ZTDdJMW9BR2x3WmNaK2dHaFJBTkNBQVRFemdDc2xaZVA3cGV5ZHZ0NzdUTUlpcjZYMW5USQpONDZKcTBwNjZoSjg0WGdTZ051THRXeUVKYzBTeFlmM29SWVZ3alBKUFFObmpxNTdxL1lJTXlWdwotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
process.env.VAPID_SUBJECT = 'mailto:tests@pulse.local';

process.env.RATE_LIMIT_DISABLED = '1';
