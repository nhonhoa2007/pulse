/**
 * TypeBox contract cho domain Auth (INF-05: contract-first).
 *
 * Đây là NGUỒN DUY NHẤT định nghĩa shape + ràng buộc đầu vào của auth.
 * Mỗi field schema được compose thành schema tổng (dùng cho OpenAPI/kiểm thử),
 * còn các hàm validate* ném AuthValidationError với code/message tương thích
 * 100% với hợp đồng hiện hành (tests khẳng định các code này).
 */
import { Type, Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { AuthValidationError, AuthUnauthorizedError } from '../modules/auth/AuthService.js';

// ---------- Field schemas ----------

export const UsernameSchema = Type.String({
  pattern: '^[a-zA-Z0-9_]{3,30}$',
  title: 'Username',
  description: '3-30 ký tự, chỉ gồm chữ cái, số và dấu gạch dưới',
});

export const EmailSchema = Type.String({
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  title: 'Email',
  description: 'Địa chỉ email hợp lệ',
});

export const RegisterPasswordSchema = Type.String({ minLength: 6, title: 'Password' });

export const DisplayNameSchema = Type.String({ minLength: 1, title: 'DisplayName' });

export const IdentifierSchema = Type.String({ minLength: 1, title: 'Identifier' });

export const LoginPasswordSchema = Type.String({ minLength: 1, title: 'Password' });

// ---------- Composed request schemas ----------

export const RegisterInputSchema = Type.Object({
  username: UsernameSchema,
  email: EmailSchema,
  password: RegisterPasswordSchema,
  displayName: DisplayNameSchema,
});

export type RegisterInputStatic = Static<typeof RegisterInputSchema>;

export const LoginInputSchema = Type.Object({
  identifier: IdentifierSchema,
  password: LoginPasswordSchema,
});

export type LoginInputStatic = Static<typeof LoginInputSchema>;

// ---------- Validators (giữ nguyên hợp đồng lỗi hiện hành) ----------

export function validateRegisterInput(input: unknown): asserts input is RegisterInputStatic {
  const body = (input ?? {}) as Record<string, unknown>;

  if (!Value.Check(UsernameSchema, body.username)) {
    throw new AuthValidationError(
      'Tên người dùng phải từ 3-30 ký tự, chỉ gồm chữ cái, số và dấu gạch dưới',
      'INVALID_USERNAME'
    );
  }
  if (!Value.Check(EmailSchema, body.email)) {
    throw new AuthValidationError('Địa chỉ email không hợp lệ', 'INVALID_EMAIL');
  }
  if (!Value.Check(RegisterPasswordSchema, body.password)) {
    throw new AuthValidationError('Mật khẩu phải có ít nhất 6 ký tự', 'INVALID_PASSWORD');
  }
  if (!Value.Check(DisplayNameSchema, body.displayName) || String(body.displayName).trim().length === 0) {
    throw new AuthValidationError('Tên hiển thị không được để trống', 'INVALID_DISPLAY_NAME');
  }
}

export function validateLoginInput(input: unknown): asserts input is LoginInputStatic {
  const body = (input ?? {}) as Record<string, unknown>;

  if (!Value.Check(IdentifierSchema, body.identifier) || !Value.Check(LoginPasswordSchema, body.password)) {
    // Giữ nguyên hợp đồng hiện hành: sai định dạng đăng nhập là 401 UNAUTHORIZED
    // (AuthUnauthorizedError), không phải 400 BAD_REQUEST.
    throw new AuthUnauthorizedError('Tên đăng nhập hoặc mật khẩu không đúng');
  }
}
