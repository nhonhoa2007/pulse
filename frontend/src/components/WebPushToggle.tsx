import React, { useState, useEffect } from 'react';
import {
  isWebPushSupported,
  isWebPushSubscribed,
  getWebPushPermission,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../utils/webPushManager';
import { usePulse } from '../context/PulseContext';
import { Bell, BellRing, Loader2, AlertCircle } from 'lucide-react';

interface WebPushToggleProps {
  compact?: boolean;
  className?: string;
}

export const WebPushToggle: React.FC<WebPushToggleProps> = ({
  compact = false,
  className = '',
}) => {
  const { addToast } = usePulse();
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    const checkStatus = async () => {
      const supported = isWebPushSupported();
      setIsSupported(supported);
      if (!supported) return;

      const perm = getWebPushPermission();
      setPermission(perm);

      const subscribed = await isWebPushSubscribed();
      setIsSubscribed(subscribed);
    };

    checkStatus();
  }, []);

  const handleToggle = async () => {
    if (!isSupported) {
      addToast('Trình duyệt của bạn không hỗ trợ thông báo đẩy.', 'error');
      return;
    }

    if (permission === 'denied') {
      addToast(
        'Bạn đã chặn thông báo. Vui lòng mở cài đặt trình duyệt để cấp quyền lại.',
        'info'
      );
      return;
    }

    setIsLoading(true);
    try {
      if (isSubscribed) {
        const res = await unsubscribeFromWebPush();
        if (res.success) {
          setIsSubscribed(false);
          addToast('Đã tắt thông báo đẩy.', 'info');
        } else {
          addToast(res.error || 'Không thể tắt thông báo đẩy.', 'error');
        }
      } else {
        const res = await subscribeToWebPush();
        if (res.success) {
          setIsSubscribed(true);
          setPermission('granted');
          addToast('Đã bật thông báo đẩy thành công! 🎉', 'success');
        } else {
          addToast(res.error || 'Không thể kích hoạt thông báo đẩy.', 'error');
        }
      }
    } catch (err: any) {
      addToast(err.message || 'Đã có lỗi xảy ra.', 'error');
    } finally {
      setIsLoading(false);
      setPermission(getWebPushPermission());
    }
  };

  if (!isSupported) {
    return compact ? null : (
      <div className={`p-3 bg-[#efefef]/50 rounded-[14px] text-[12px] text-[#969696] flex items-center gap-2 ${className}`}>
        <AlertCircle className="w-4 h-4 text-[#969696] shrink-0" />
        <span>Trình duyệt hiện tại không hỗ trợ thông báo đẩy Web Push.</span>
      </div>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={isLoading}
        className={`flex items-center justify-between w-full px-3 py-2 text-[13px] font-medium text-[#000000] hover:bg-[#efefef] rounded-xl transition-colors text-left focus:outline-none ${className}`}
        title={isSubscribed ? 'Tắt thông báo đẩy' : 'Bật thông báo đẩy'}
        data-testid="web-push-compact-toggle"
      >
        <div className="flex items-center gap-2.5">
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#385898]" />
          ) : isSubscribed ? (
            <BellRing className="w-4 h-4 text-[#385898]" />
          ) : (
            <Bell className="w-4 h-4 text-[#424242]" />
          )}
          <span>Thông báo đẩy</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              isSubscribed
                ? 'bg-[#385898]/10 text-[#385898]'
                : 'bg-[#efefef] text-[#969696]'
            }`}
          >
            {isSubscribed ? 'BẬT' : 'TẮT'}
          </span>
        </div>
      </button>
    );
  }

  return (
    <div
      className={`p-4 bg-[#efefef]/40 border border-[#d5d5d5] rounded-[16px] transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${className}`}
      data-testid="web-push-prompt-card"
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
            isSubscribed
              ? 'bg-[#385898]/10 text-[#385898]'
              : 'bg-[#efefef] text-[#424242]'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-[#385898]" />
          ) : isSubscribed ? (
            <BellRing className="w-5 h-5 stroke-[2]" />
          ) : (
            <Bell className="w-5 h-5 stroke-[2]" />
          )}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-[14px] font-semibold text-[#000000]">
              Thông báo đẩy trên trình duyệt
            </h4>
            {permission === 'denied' && (
              <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full uppercase">
                Bị chặn
              </span>
            )}
          </div>
          <p className="text-[12.5px] text-[#424242] mt-0.5 max-w-md leading-relaxed">
            Nhận thông báo tức thì về tương tác bài viết, tin nhắn và người theo dõi mới ngay cả khi không mở tab Pulse.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={isSubscribed}
          onClick={handleToggle}
          disabled={isLoading || permission === 'denied'}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            isSubscribed ? 'bg-[#000000]' : 'bg-[#d5d5d5]'
          } ${isLoading || permission === 'denied' ? 'opacity-50 cursor-not-allowed' : ''}`}
          title={isSubscribed ? 'Tắt thông báo đẩy' : 'Bật thông báo đẩy'}
          data-testid="web-push-switch"
        >
          <span className="sr-only">Bật/tắt thông báo đẩy</span>
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              isSubscribed ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
};
