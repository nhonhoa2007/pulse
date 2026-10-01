import React, { useState, useEffect } from 'react';
import { usePulse } from '../context/PulseContext';
import { X, Loader2, AlertCircle } from 'lucide-react';

export const AuthModal: React.FC = () => {
  const {
    isAuthModalOpen,
    setIsAuthModalOpen,
    authModalTab,
    setAuthModalTab,
    login,
    register,
  } = usePulse();

  // Login form states
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form states
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset errors and fields on open/tab change
  useEffect(() => {
    if (isAuthModalOpen) {
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [isAuthModalOpen, authModalTab]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAuthModalOpen && !isSubmitting) {
        setIsAuthModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthModalOpen, isSubmitting, setIsAuthModalOpen]);

  if (!isAuthModalOpen) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setIsAuthModalOpen(false);
    setErrorMessage(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const identifier = loginIdentifier.trim();
    const password = loginPassword;

    if (!identifier) {
      setErrorMessage('Vui lòng nhập tên đăng nhập hoặc địa chỉ email.');
      return;
    }
    if (!password) {
      setErrorMessage('Vui lòng nhập mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login(identifier, password);
      // Login clears state and closes modal inside context
      setLoginIdentifier('');
      setLoginPassword('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const displayName = regDisplayName.trim();
    let username = regUsername.trim();
    if (username.startsWith('@')) {
      username = username.substring(1);
    }
    const email = regEmail.trim();
    const password = regPassword;

    if (!displayName) {
      setErrorMessage('Vui lòng nhập tên hiển thị.');
      return;
    }
    if (!username) {
      setErrorMessage('Vui lòng nhập tên người dùng (@username).');
      return;
    }
    if (username.length < 3) {
      setErrorMessage('Tên người dùng phải có ít nhất 3 ký tự.');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setErrorMessage('Tên người dùng chỉ được chứa chữ cái, số và dấu gạch dưới (_).');
      return;
    }
    if (!email || !email.includes('@')) {
      setErrorMessage('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }
    if (!password || password.length < 6) {
      setErrorMessage('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await register({
        displayName,
        username,
        email,
        password,
      });
      // Register clears state and closes modal inside context
      setRegDisplayName('');
      setRegUsername('');
      setRegEmail('');
      setRegPassword('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Đăng ký tài khoản thất bại. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="w-full max-w-md bg-[#fafafa] border border-[#d5d5d5] rounded-[18px] shadow-[0_0_24px_rgba(0,0,0,0.12)] overflow-hidden animate-scale-up">
        {/* Modal Header (~53px tall, Threads Logo & Close button) */}
        <div className="flex items-center justify-between h-[53px] px-4 border-b border-[#d5d5d5] bg-[#fafafa]">
          <div className="w-8" />
          {/* Threads Icon */}
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 192 192"
              className="w-6 h-6 text-[#000000] fill-current"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M141.537 88.9883C140.71 88.5919 139.87 88.2104 139.019 87.8451C137.587 60.5305 122.244 44.0538 96.0601 44.0538C69.5277 44.0538 52.8134 61.4354 52.8134 88.6676C52.8134 116.14 69.8058 133.565 96.0601 133.565C108.825 133.565 119.593 129.544 127.351 121.849C128.847 120.364 130.134 118.665 131.218 116.782L116.921 106.828C115.962 108.318 114.779 109.68 113.388 110.871C108.868 114.743 102.778 116.969 95.8906 116.969C79.8087 116.969 69.5393 105.109 69.0558 87.6254C75.3341 89.9248 82.2644 91.246 89.6083 91.246C112.571 91.246 126.969 78.4319 126.969 61.2721C126.969 47.9152 116.275 38.6472 96.2295 38.6472C69.176 38.6472 50.1171 58.0772 50.1171 90.0072C50.1171 122.183 69.6053 141.776 96.3989 141.776C112.923 141.776 126.786 135.918 136.438 124.786C145.454 114.385 150.316 99.4673 150.316 82.1643C150.316 48.7497 129.805 28.5303 96.0601 28.5303C58.8718 28.5303 33.5654 54.4988 33.5654 90.9634C33.5654 127.818 58.7495 153.947 96.0601 153.947C114.28 153.947 130.407 147.288 141.349 135.197L153.284 145.98C138.835 161.792 118.987 170.36 96.0601 170.36C49.9961 170.36 17 136.262 17 90.9634C17 45.4851 50.1655 12 96.0601 12C140.71 12 166.881 38.8344 166.881 82.1643C166.881 103.882 160.835 122.427 149.336 135.342C136.85 149.366 118.847 157.061 96.3989 157.061C61.4332 157.061 34.6293 129.088 34.6293 89.6234C34.6293 50.5393 61.1618 22.2343 96.2295 22.2343C122.128 22.2343 143.149 35.8087 143.518 57.8288C143.518 70.8385 133.535 79.1672 117.848 79.1672C110.871 79.1672 104.996 77.2942 99.8703 73.6631C94.8872 70.1345 92.1741 65.4682 92.1741 59.8887C92.1741 53.6496 97.0984 49.6917 104.425 49.6917C110.985 49.6917 114.939 52.7937 115.352 57.8687L131.758 56.666C130.686 45.7483 120.354 36.637 104.425 36.637C89.5447 36.637 76.5847 45.5492 76.5847 60.1065C76.5847 70.1009 82.1953 78.4319 91.242 83.2501C86.7118 84.4447 82.1953 85.042 77.5684 85.042C74.6713 85.042 71.854 84.7934 69.1362 84.3059C71.3917 104.285 86.8157 116.892 103.543 116.892C113.881 116.892 122.569 112.565 128.799 104.42" />
            </svg>
            <span id="auth-modal-title" className="text-[15px] font-semibold text-[#000000]">
              {authModalTab === 'login' ? 'Đăng nhập vào Pulse' : 'Tạo tài khoản mới'}
            </span>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="w-8 h-8 flex items-center justify-center text-[#969696] hover:text-[#000000] rounded-full hover:bg-[#efefef] transition-colors focus:outline-none"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher: Đăng nhập vs Đăng ký */}
        <div className="grid grid-cols-2 text-center text-[15px] border-b border-[#d5d5d5]">
          <button
            type="button"
            onClick={() => {
              setAuthModalTab('login');
              setErrorMessage(null);
            }}
            className={`py-3 relative font-semibold transition-colors focus:outline-none ${
              authModalTab === 'login'
                ? 'text-[#000000]'
                : 'text-[#969696] hover:text-[#000000]'
            }`}
          >
            <span>Đăng nhập</span>
            {authModalTab === 'login' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-[#000000]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setAuthModalTab('register');
              setErrorMessage(null);
            }}
            className={`py-3 relative font-semibold transition-colors focus:outline-none ${
              authModalTab === 'register'
                ? 'text-[#000000]'
                : 'text-[#969696] hover:text-[#000000]'
            }`}
          >
            <span>Đăng ký</span>
            {authModalTab === 'register' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-[#000000]" />
            )}
          </button>
        </div>

        {/* Error message alert */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-[#efefef] border border-[#d5d5d5] rounded-xl flex items-start gap-2.5 text-[13px] text-[#000000]">
            <AlertCircle className="w-4 h-4 text-[#000000] shrink-0 mt-0.5" />
            <span className="leading-snug">{errorMessage}</span>
          </div>
        )}

        {/* Form Body */}
        {authModalTab === 'login' ? (
          <form onSubmit={handleLoginSubmit} className="p-6 space-y-4">
            <div>
              <label
                htmlFor="login-identifier"
                className="block text-[13px] font-semibold text-[#000000] mb-1.5"
              >
                Tên đăng nhập hoặc Email
              </label>
              <input
                id="login-identifier"
                type="text"
                autoComplete="username"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder="alice hoặc dev@pulse.vn"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-[#ffffff] border border-[#d5d5d5] rounded-xl text-[15px] text-[#000000] placeholder-[#969696] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-[13px] font-semibold text-[#000000] mb-1.5"
              >
                Mật khẩu
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-[#ffffff] border border-[#d5d5d5] rounded-xl text-[15px] text-[#000000] placeholder-[#969696] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
              />
            </div>

            {/* Pill Submit Button (#000000 bg, #fafafa text, 15px/600) */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-full bg-[#000000] text-[#fafafa] text-[15px] font-semibold hover:bg-[#000000]/85 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 focus:outline-none"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#fafafa]" />
                    <span>Đang đăng nhập...</span>
                  </>
                ) : (
                  <span>Đăng nhập</span>
                )}
              </button>
            </div>

            <div className="text-center pt-2">
              <p className="text-[13px] text-[#424242]">
                Chưa có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalTab('register');
                    setErrorMessage(null);
                  }}
                  className="text-[#385898] hover:underline font-semibold focus:outline-none"
                >
                  Đăng ký ngay
                </button>
              </p>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="p-6 space-y-3.5">
            <div>
              <label
                htmlFor="reg-display-name"
                className="block text-[13px] font-semibold text-[#000000] mb-1"
              >
                Tên hiển thị
              </label>
              <input
                id="reg-display-name"
                type="text"
                autoComplete="name"
                value={regDisplayName}
                onChange={(e) => setRegDisplayName(e.target.value)}
                placeholder="Nguyễn Văn A"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2 bg-[#ffffff] border border-[#d5d5d5] rounded-xl text-[15px] text-[#000000] placeholder-[#969696] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                autoFocus
              />
            </div>

            <div>
              <label
                htmlFor="reg-username"
                className="block text-[13px] font-semibold text-[#000000] mb-1"
              >
                Tên người dùng (@username)
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3.5 text-[#969696] text-[15px]">@</span>
                <input
                  id="reg-username"
                  type="text"
                  autoComplete="username"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value.replace(/^@/, ''))}
                  placeholder="username"
                  disabled={isSubmitting}
                  className="w-full pl-8 pr-3.5 py-2 bg-[#ffffff] border border-[#d5d5d5] rounded-xl text-[15px] text-[#000000] placeholder-[#969696] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="reg-email"
                className="block text-[13px] font-semibold text-[#000000] mb-1"
              >
                Email
              </label>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="name@example.com"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2 bg-[#ffffff] border border-[#d5d5d5] rounded-xl text-[15px] text-[#000000] placeholder-[#969696] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="reg-password"
                className="block text-[13px] font-semibold text-[#000000] mb-1"
              >
                Mật khẩu
              </label>
              <input
                id="reg-password"
                type="password"
                autoComplete="new-password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Ít nhất 6 ký tự"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2 bg-[#ffffff] border border-[#d5d5d5] rounded-xl text-[15px] text-[#000000] placeholder-[#969696] focus:outline-none focus:border-[#000000] focus:ring-1 focus:ring-[#000000] transition-colors"
              />
            </div>

            {/* Pill Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 rounded-full bg-[#000000] text-[#fafafa] text-[15px] font-semibold hover:bg-[#000000]/85 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-2 focus:outline-none"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#fafafa]" />
                    <span>Đang đăng ký...</span>
                  </>
                ) : (
                  <span>Tạo tài khoản</span>
                )}
              </button>
            </div>

            <div className="text-center pt-1">
              <p className="text-[13px] text-[#424242]">
                Đã có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalTab('login');
                    setErrorMessage(null);
                  }}
                  className="text-[#385898] hover:underline font-semibold focus:outline-none"
                >
                  Đăng nhập
                </button>
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
