import { useState } from "react";
import { ImageBroken } from "@phosphor-icons/react";

/**
 * Product screenshot with an honest empty state.
 *
 * Drop the real PNG at public/shots/<name>.png and it renders. Until then this
 * shows a labelled slot instead of a browser's broken-image glyph, so the page
 * never pretends a screenshot exists and never looks half-loaded.
 */
export function Screenshot({
  src,
  alt,
  className = "",
  eager = false,
  width,
  height,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
        className={`flex h-full w-full flex-col items-center justify-center gap-2.5 bg-ink-850 p-6 text-center ${className}`}
      >
        <ImageBroken size={22} weight="regular" className="text-fg-dim" />
        <span className="max-w-[42ch] text-[13px] leading-relaxed text-fg-dim">
          {alt}
        </span>
        <code className="font-mono text-[11.5px] text-fg-dim/70">{src}</code>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
