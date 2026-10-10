// Original icons for the simulated desktop. The browser icon is a generic
// globe, not Chromium's logo; the start button is the Yanix chip.

interface IconProps {
  className?: string;
}

export function BrowserIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="ico-browser" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6aa8ff" />
          <stop offset="1" stopColor="#2fd0f0" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="url(#ico-browser)" />
      <ellipse cx="16" cy="16" rx="5.5" ry="13" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.6" />
      <path d="M3.5 12h25M3.5 20h25" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="13" fill="none" stroke="#ffffff" strokeOpacity="0.3" />
    </svg>
  );
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="3" y="5" width="26" height="22" rx="4" fill="#1b1f27" stroke="#3b4452" />
      <path d="m8 12 4.5 4L8 20" fill="none" stroke="#5eead4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 21h8" stroke="#e8edf2" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function WelcomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="4" y="4" width="24" height="24" rx="6" fill="#ffb35c" />
      <path d="M11 17.5 14.5 21 21.5 11.5" fill="none" stroke="#2a1700" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M16 3.5 27 9.75v12.5L16 28.5 5 22.25V9.75z" fill="#3fe0ff" fillOpacity="0.18" stroke="#3fe0ff" strokeWidth="1.8" />
      <path d="M11.5 11.5 16 17l4.5-5.5M16 17v5" fill="none" stroke="#e8f9ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m15 15 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EthernetIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="4" y="5" width="16" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 16v3h8v-3M9 9v3M12 9v3M15 9v3" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M4 10h3l5-4v12l-5-4H4z" fill="currentColor" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 7v4.2M8 4.8v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
