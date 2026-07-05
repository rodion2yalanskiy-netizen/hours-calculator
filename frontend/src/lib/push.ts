// Web Push: регистрация SW, запрос разрешения, подписка/отписка (Слой 7b/7c).
import { getVapidPublicKey, subscribeToPush, unsubscribeFromPush as apiUnsubscribe } from '../api';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function isPushSupportedInBrowser(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getPushPermissionStatus(): 'granted' | 'denied' | 'default' {
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission;
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

/** iOS Safari и приложение НЕ добавлено на «Экран Домой» → нужна PWA-установка для push. */
export function isIOSNeedingInstall(): boolean {
  return isIOS() && !isStandalone();
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); }
  catch { return null; }
}

/** true если уже есть активная push-подписка. */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!isPushSupportedInBrowser()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  return !!(await reg.pushManager.getSubscription());
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'no_push_api'; ios_pwa_needed: boolean }
  | { ok: false; reason: 'permission_denied' }
  | { ok: false; reason: 'sw_registration_failed'; details: string }
  | { ok: false; reason: 'server_error'; details: string }
  | { ok: false; reason: 'no_vapid_key' };

/** Запросить разрешение и подписаться. Возвращает конкретную причину при неудаче. */
export async function requestPermissionAndSubscribe(): Promise<SubscribeResult> {
  if (!('PushManager' in window) || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return { ok: false, reason: 'no_push_api', ios_pwa_needed: isIOS() && !isStandalone() };
  }
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: 'sw_registration_failed', details: 'service worker registration failed' };

  let perm: NotificationPermission;
  try { perm = await Notification.requestPermission(); }
  catch { return { ok: false, reason: 'permission_denied' }; }
  if (perm !== 'granted') return { ok: false, reason: 'permission_denied' };

  let key: string;
  try { key = await getVapidPublicKey(); }
  catch (e) { return { ok: false, reason: 'server_error', details: e instanceof Error ? e.message : 'network error' }; }
  if (!key) return { ok: false, reason: 'no_vapid_key' };

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
    const json = sub.toJSON();
    await subscribeToPush({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
      user_agent: navigator.userAgent,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'server_error', details: e instanceof Error ? e.message : 'subscribe failed' };
  }
}

/** Отписаться в браузере и на сервере. */
export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* ignore */ }
  try { await apiUnsubscribe(endpoint); } catch { /* ignore */ }
}
