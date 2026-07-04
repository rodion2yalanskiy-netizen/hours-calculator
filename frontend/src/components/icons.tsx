// Иконки — inline SVG в стиле Tabler outline (без внешних зависимостей).
export type IconProps = { className?: string };

const base = (className?: string) => ({
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const, className,
});

export const IconLock = ({ className }: IconProps) => (
  <svg {...base(className)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const IconMapPin = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>
);
export const IconClock = ({ className }: IconProps) => (
  <svg {...base(className)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconUsers = ({ className }: IconProps) => (
  <svg {...base(className)}><circle cx="9" cy="8" r="3" /><path d="M4 20a5 5 0 0 1 10 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M18 20a5 5 0 0 0-3-4.6" /></svg>
);
export const IconWallet = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M4 6a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v2" /><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="16" cy="12" r="1.3" /></svg>
);
export const IconChart = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" rx="1" /><rect x="13" y="7" width="3" height="9" rx="1" /></svg>
);
export const IconCopy = ({ className }: IconProps) => (
  <svg {...base(className)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
export const IconChevL = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M15 6l-6 6 6 6" /></svg>
);
export const IconChevR = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M9 6l6 6-6 6" /></svg>
);
export const IconChevDown = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconUser = ({ className }: IconProps) => (
  <svg {...base(className)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const IconLogout = ({ className }: IconProps) => (
  <svg {...base(className)}><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
);
