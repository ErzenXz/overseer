import { useState, type SyntheticEvent } from "react";

// Shot is a real screenshot of the app. The site is dark, so it shows the dark
// capture unless asked for the light one (the light feature band, the docs).
// Until the image is decoded the frame shows a soft placeholder in the page's
// own colours, then the image fades in, so nothing pops.
const SIZES: Record<string, [number, number]> = {
  hero: [3200, 2000],
  "phone-session": [780, 1688],
  "phone-home": [780, 1688],
};

// useFadeIn marks an <img> loaded once it has decoded, including when it was
// already in the cache before React attached the handler.
function useFadeIn() {
  const [loaded, setLoaded] = useState(false);
  const ref = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0 && !loaded) setLoaded(true);
  };
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).finally(() => setLoaded(true));
  };
  return { loaded, ref, onLoad, onError: () => setLoaded(true) };
}

export function Shot({ name, alt, className = "", crop = false, eager = false, theme = "dark" }: { name: string; alt: string; className?: string; crop?: boolean; eager?: boolean; theme?: "dark" | "light" }) {
  const [width, height] = SIZES[name] ?? [2000, 1250];
  const phone = name.startsWith("phone-");
  const { loaded, ref, onLoad, onError } = useFadeIn();
  return (
    <div className={`shot shot--${theme} ${loaded ? "is-loaded" : ""} ${crop ? "shot-crop" : ""} ${phone ? "shot-phone" : ""} ${className}`}>
      <img ref={ref} onLoad={onLoad} onError={onError} src={`/shots/${theme}/${name}.webp`} alt={alt} width={width} height={height} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchPriority: "high" as const } : {})} />
    </div>
  );
}

// Art is the Orbit sculpture (made with Codex image generation).
export function Art({ name, alt = "", className = "" }: { name: "orbit-dark" | "orbit-light" | "orbit-wide" | "orbit-square"; alt?: string; className?: string }) {
  const { loaded, ref, onLoad, onError } = useFadeIn();
  return <img ref={ref} onLoad={onLoad} onError={onError} src={`/art/${name}.webp`} alt={alt} width={1600} height={914} loading="lazy" decoding="async" className={`fade-img ${loaded ? "is-loaded" : ""} h-full w-full object-cover ${className}`} />;
}
