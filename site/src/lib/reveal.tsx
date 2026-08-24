import { useEffect, useRef, type ReactNode } from "react";

type Tag = "div" | "section" | "figure" | "ol" | "ul";

/**
 * Scroll reveal, CSS-driven on purpose.
 *
 * Content is visible by default. Only when the inline script in index.html has
 * added `js-reveal` to <html> (JS on, and the reader has not asked for reduced
 * motion) does it start hidden and transition in. So a stalled animation frame,
 * a background tab, or no JS at all leaves the page readable instead of blank.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: Tag;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!document.documentElement.classList.contains("js-reveal")) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}s` } : undefined}
    >
      {children}
    </Tag>
  );
}
