// Shot is a real screenshot of the app in the reader's theme: light and dark
// captures of the same screen, swapped by prefers-color-scheme.
const SIZES: Record<string, [number, number]> = {
  hero: [3200, 2000],
  "phone-session": [780, 1688],
  "phone-home": [780, 1688],
};

export function Shot({
  name,
  alt,
  className = "",
  crop = false,
  eager = false,
}: {
  name: string;
  alt: string;
  className?: string;
  crop?: boolean;
  eager?: boolean;
}) {
  const [width, height] = SIZES[name] ?? [2000, 1250];
  const phone = name.startsWith("phone-");
  return (
    <div className={`shot ${crop ? "shot-crop" : ""} ${phone ? "shot-phone" : ""} ${className}`}>
      <picture>
        <source srcSet={`/shots/dark/${name}.webp`} media="(prefers-color-scheme: dark)" />
        <img
          src={`/shots/light/${name}.webp`}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          {...(eager ? { fetchPriority: "high" as const } : {})}
        />
      </picture>
    </div>
  );
}

// Art is the Orbit sculpture (made with Codex image generation), lit to match
// the theme.
export function Art({ name, alt = "", className = "" }: { name: "orbit" | "orbit-wide" | "orbit-square"; alt?: string; className?: string }) {
  const light = name === "orbit" ? "orbit-light" : name;
  const dark = name === "orbit" ? "orbit-dark" : name;
  return (
    <picture className={className}>
      <source srcSet={`/art/${dark}.webp`} media="(prefers-color-scheme: dark)" />
      <img src={`/art/${light}.webp`} alt={alt} width={1600} height={914} loading="lazy" decoding="async" className="h-full w-full object-cover" />
    </picture>
  );
}
