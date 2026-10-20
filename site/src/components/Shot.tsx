// Shot is a real screenshot of the app. The site is dark, so it shows the dark
// capture unless asked for the light one (the light feature band).
const SIZES: Record<string, [number, number]> = {
  hero: [3200, 2000],
  "phone-session": [780, 1688],
  "phone-home": [780, 1688],
};

export function Shot({ name, alt, className = "", crop = false, eager = false, theme = "dark" }: { name: string; alt: string; className?: string; crop?: boolean; eager?: boolean; theme?: "dark" | "light" }) {
  const [width, height] = SIZES[name] ?? [2000, 1250];
  const phone = name.startsWith("phone-");
  return (
    <div className={`shot ${crop ? "shot-crop" : ""} ${phone ? "shot-phone" : ""} ${className}`}>
      <img src={`/shots/${theme}/${name}.webp`} alt={alt} width={width} height={height} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchPriority: "high" as const } : {})} />
    </div>
  );
}

// Art is the Orbit sculpture (made with Codex image generation).
export function Art({ name, alt = "", className = "" }: { name: "orbit-dark" | "orbit-light" | "orbit-wide" | "orbit-square"; alt?: string; className?: string }) {
  return <img src={`/art/${name}.webp`} alt={alt} width={1600} height={914} loading="lazy" decoding="async" className={`h-full w-full object-cover ${className}`} />;
}
