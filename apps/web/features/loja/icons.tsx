// Ícones de linha simples (sem dependência externa) — visual neutro parecido com apps de
// cardápio online, no lugar de emoji colorido.
type IconSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<IconSize, string> = {
  sm: "loja__icon",
  md: "loja__icon loja__icon--md",
  lg: "loja__icon loja__icon--lg",
};

function Svg({ size, strokeWidth, children }: { size: IconSize; strokeWidth: number; children: React.ReactNode }) {
  // Ícones são decorativos: o nome vem do texto ao lado (ou do aria-label do botão).
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={SIZE_CLASS[size]} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export function PinIcon() {
  return (
    <Svg size="sm" strokeWidth={1.8}>
      <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </Svg>
  );
}

export function CoinIcon() {
  return (
    <Svg size="sm" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.5 9.5h3.8a1.7 1.7 0 0 1 0 3.4H10a1.7 1.7 0 0 0 0 3.4h4.5" />
    </Svg>
  );
}

export function SearchIcon({ size = "sm" }: { size?: IconSize }) {
  return (
    <Svg size={size} strokeWidth={1.8}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.3-4.3" strokeLinecap="round" />
    </Svg>
  );
}

export function ChatIcon() {
  return (
    <Svg size="sm" strokeWidth={1.8}>
      <path d="M21 11.5a8.5 8.5 0 0 1-12.9 7.3L3 20l1.3-5A8.5 8.5 0 1 1 21 11.5Z" />
    </Svg>
  );
}

export function ListIcon() {
  return (
    <Svg size="lg" strokeWidth={1.8}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" strokeLinecap="round" />
    </Svg>
  );
}

export function OrdersIcon() {
  return (
    <Svg size="lg" strokeWidth={1.8}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 2.5h6M9 9h6M9 13h6M9 17h3" strokeLinecap="round" />
    </Svg>
  );
}

export function CloseIcon() {
  return (
    <Svg size="lg" strokeWidth={2}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </Svg>
  );
}

export function ClockIcon() {
  return (
    <Svg size="md" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronIcon() {
  return (
    <Svg size="md" strokeWidth={2}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TrashIcon() {
  return (
    <Svg size="md" strokeWidth={1.8}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function InfoIcon() {
  return (
    <Svg size="md" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </Svg>
  );
}
