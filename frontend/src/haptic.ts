// Тактильная отдача через web Vibration API (замена Telegram HapticFeedback).
// Тихо ничего не делает, если API недоступен (iOS Safari его не поддерживает).
export function haptic(kind: 'light' | 'success' = 'light'): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate !== 'function') return;
    nav.vibrate(kind === 'success' ? [10, 40, 10] : 8);
  } catch { /* no-op */ }
}
