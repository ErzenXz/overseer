import { useEffect, useState } from "react";

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Advances through `delays.length` stages (each delay is ms from mount).
 * Readers who prefer reduced motion get the final stage immediately.
 */
export function useStages(delays: number[]) {
  const [reduced] = useState(prefersReducedMotion);
  const [stage, setStage] = useState(reduced ? delays.length : 0);
  const key = delays.join(",");
  useEffect(() => {
    if (reduced) return;
    const ids = key
      .split(",")
      .map((ms, i) => window.setTimeout(() => setStage(i + 1), Number(ms)));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [key, reduced]);
  return { stage, reduced };
}

/** Reveals `total` units one at a time once `start` is true. */
export function useStream(total: number, start: boolean, ms = 34) {
  const [reduced] = useState(prefersReducedMotion);
  const [count, setCount] = useState(reduced ? total : 0);
  useEffect(() => {
    if (!start || reduced) return;
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= total) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, ms);
    return () => window.clearInterval(id);
  }, [start, total, ms, reduced]);
  return reduced ? total : count;
}
