import { useId } from "react";

/**
 * The Overseer mark and wordmark. This is the only place the logo is drawn,
 * so swapping the icon later is a one-file change (plus public/favicon.svg).
 */
export function LogoMark({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  // Orbit: a ring around the hub with one live agent in orbit. The ring
  // follows the text colour; the blue satellite is cut out of it with a mask.
  const mask = useId();
  return (
    <svg
      viewBox="196 188 640 640"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
    >
      <defs>
        <mask id={mask}>
          <rect x="196" y="188" width="640" height="640" fill="#fff" />
          <circle cx="724" cy="300" r="114" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`} fill="currentColor">
        <circle
          cx="500"
          cy="524"
          r="270"
          fill="none"
          stroke="currentColor"
          strokeWidth="68"
        />
        <circle cx="500" cy="524" r="104" />
      </g>
      <circle cx="724" cy="300" r="74" fill="#3b82f6" />
    </svg>
  );
}

export function Logo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span className="text-[15.5px] font-semibold tracking-[-0.02em]">
        Overseer
      </span>
    </span>
  );
}
