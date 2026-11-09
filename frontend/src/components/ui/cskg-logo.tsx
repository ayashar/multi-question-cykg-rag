interface CskgLogoProps {
  className?: string;
}

export function CskgLogo({ className = "size-11" }: CskgLogoProps) {
  return (
    <svg
      aria-label="CSKG logo"
      className={`shrink-0 ${className}`}
      role="img"
      viewBox="0 0 44 44"
    >
      <rect width="44" height="44" rx="12" fill="#442b54" />
      <path
        d="M14 14 30 14 22 29 14 14Z"
        fill="none"
        stroke="#d6c6e1"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle cx="14" cy="14" r="3.5" fill="#fff" />
      <circle cx="30" cy="14" r="3.5" fill="#fff" />
      <circle cx="22" cy="29" r="3.5" fill="#fff" />
    </svg>
  );
}
