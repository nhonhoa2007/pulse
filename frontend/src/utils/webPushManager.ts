import { api } from '../api/PulseApiClient.ts';
import type { WebPushSubscriptionDto } from '../types/PulseTypes.ts';

/**
 * Convert a URL-safe Base64 string to a Uint8Array for Web Push applicationServerKey
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const atobFn =
    typeof window !== 'undefined' && typeof window.atob === 'function'
      ? window.atob.bind(window)
      : typeof atob === 'function'
      ? atob
      : ((globalThis as any).atob as (s: string) => string);

  const rawData = atobFn(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Check if the browser supports Service Worker and Web Push Notifications
 */
export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Current notification permission state
 */
export function getWebPushPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Check if the client is currently subscribed to push notifications
 */
export async function isWebPushSubscribed(): Promise<boolean> {
  if (!isWebPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) return false;

    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/**
 * Full Service Worker & VAPID push subscription registration flow
 */
export async function subscribeToWebPush(): Promise<{
  success: boolean;
  subscription?: WebPushSubscriptionDto;
  error?: string;
}> {
  if (!isWebPushSupported()) {
    return {
      success: false,
      error: 'Trình duyệt của bạn không hỗ trợ tính năng Web Push Notifications.',
    };
  }

  try {
    // 1. Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error:
          permission === 'denied'
            ? 'Quyền nhận thông báo đã bị từ chối trong cài đặt trình duyệt.'
            : 'Người dùng đã hủy yêu cầu cấp quyền thông báo.',
      };
    }

    // 2. Fetch VAPID public key from backend
    const publicKey = await api.getVapidPublicKey();
    if (!publicKey) {
      return {
        success: false,
        error: 'Không thể lấy VAPID public key từ máy chủ.',
      };
    }

    // 3. Register or locate Service Worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // 4. Subscribe via PushManager
    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    const pushSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey as any,
    });

    // 5. Extract keys
    const p256dhKey = pushSubscription.getKey('p256dh');
    const authKey = pushSubscription.getKey('auth');

    const p256dh = p256dhKey
      ? btoa(String.fromCharCode(...new Uint8Array(p256dhKey)))
      : '';
    const auth = authKey
      ? btoa(String.fromCharCode(...new Uint8Array(authKey)))
      : '';

    // 6. Post subscription to backend
    const registered = await api.registerPushSubscription({
      endpoint: pushSubscription.endpoint,
      keys: {
        p256dh,
        auth,
      },
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });

    if (typeof window !== 'undefined') {
      localStorage.setItem('pulse_push_enabled', 'true');
    }

    return {
      success: true,
      subscription: registered,
    };
  } catch (err: any) {
    console.error('Failed to subscribe to Web Push:', err);
    return {
      success: false,
      error: err.message || 'Không thể đăng ký nhận thông báo đẩy.',
    };
  }
}

/**
 * Unregister push subscription from both browser and backend
 */
export async function unsubscribeFromWebPush(): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!isWebPushSupported()) {
    return { success: true };
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (registration) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Unregister from server
        try {
          await api.unregisterPushSubscription(subscription.endpoint);
        } catch {
          // ignore backend cleanup failure
        }
        // Unsubscribe locally
        await subscription.unsubscribe();
      }
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem('pulse_push_enabled', 'false');
    }

    return { success: true };
  } catch (err: any) {
    console.error('Failed to unsubscribe from Web Push:', err);
    return {
      success: false,
      error: err.message || 'Không thể hủy đăng ký thông báo đẩy.',
    };
  }
}
