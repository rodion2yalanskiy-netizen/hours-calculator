// Web Push: регистрация SW, запрос разрешения, подписка/отписка (Слой 7b).
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

/** iOS Safari и приложение НЕ добавлено на главный экран → нужна установка для push. */
export function isIOSNeedingInstall(): boolean {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return isIOS && !standalone;
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

/** Запросить разрешение и подписаться. Возвращает true при успехе. */
export async function requestPermissionAndSubscribe(): Promise<boolean> {
  if (!isPushSupportedInBrowser()) return false;
  const reg = await registerServiceWorker();
  if (!reg) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const key = await getVapidPublicKey();
  if (!key) return false;
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
  return true;
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
