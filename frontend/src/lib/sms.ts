// Открытие системного SMS с предзаполненным номером и текстом (iOS/Android).
// Автоотправка невозможна — только открытие приложения сообщений (защита платформ).
export function openSMS(phone: string, body: string): void {
  const encoded = encodeURIComponent(body);
  window.location.href = `sms:${phone}?body=${encoded}`;
}
