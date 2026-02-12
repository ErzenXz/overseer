"use client";

import dynamic from "next/dynamic";
import React, { useEffect, useMemo, useRef, useState } from "react";

const GrainGradient = dynamic(
  () => import("@paper-design/shaders-react").then((mod) => mod.GrainGradient),
  { ssr: false }
);

const Dithering = dynamic(
  () => import("@paper-design/shaders-react").then((mod) => mod.Dithering),
  { ssr: false }
);

type LazyMode = "idle" | "visible" | "immediate";

type CommonProps = {
  /** Renders behind content. Always provide an explicit size on the wrapper via className/style. */
  className?: string;
  style?: React.CSSProperties;
  /** What to render while the shader is disabled/unmounted. */
  fallback?: React.ReactNode;
  /** When to mount the shader. */
  mode?: LazyMode;
  /** Root margin for the visibility observer (when mode="visible"). */
  rootMargin?: string;
  /** Disable entirely (forces fallback). */
  disabled?: boolean;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function shouldAvoidHeavyGL(): boolean {
  if (typeof window === "undefined") return true;

  // Respect user preference.
  if (prefersReducedMotion()) return true;

  // Data saver.
  type NavigatorConnection = { saveData?: boolean; effectiveType?: string };
  const conn = (navigator as unknown as { connection?: NavigatorConnection })
    .connection;
  if (conn?.saveData) return true;

  // Very low core count devices tend to struggle with full-screen WebGL.
  const cores = navigator.hardwareConcurrency ?? 4;
  if (cores <= 4) return true;

  return false;
}

function useInView<T extends Element>(
  options: IntersectionObserverInit & { enabled?: boolean } = {}
) {
  const { enabled = true, ...io } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  const ioOptions = useMemo<IntersectionObserverInit>(
    () => ({ root: io.root, rootMargin: io.rootMargin, threshold: io.threshold }),
    [io.root, io.rootMargin, io.threshold]
  );

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
    }, ioOptions);

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, ioOptions]);

  return { ref, inView };
}

function useIdleTrigger(enabled: boolean, delayMs: number) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const done = () => {
      if (!cancelled) setReady(true);
    };

    // Prefer requestIdleCallback when available.
    type IdleCb = (deadline: IdleDeadline) => void;
    type IdleOpts = { timeout: number };
    type WindowRIC = Window & {
      requestIdleCallback?: (cb: IdleCb, opts?: IdleOpts) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    const w = window as WindowRIC;

    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => done(), { timeout: delayMs });
      return () => {
        cancelled = true;
        w.cancelIdleCallback?.(id);
      };
    }

    const t = window.setTimeout(done, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [enabled, delayMs]);

  return ready;
}

export type LazyGrainGradientProps = CommonProps & {
  kind: "grain";
  shaderProps: React.ComponentProps<typeof GrainGradient>;
};

export type LazyDitheringProps = CommonProps & {
  kind: "dither";
  shaderProps: React.ComponentProps<typeof Dithering>;
};

export type LazyShaderProps = LazyGrainGradientProps | LazyDitheringProps;

export default function LazyShader(props: LazyShaderProps) {
  const {
    className,
    style,
    fallback,
    mode = "idle",
    rootMargin = "200px",
    disabled,
  } = props;

  const avoid = useMemo(() => shouldAvoidHeavyGL(), []);
  const shaderAllowed = !disabled && !avoid;

  const { ref, inView } = useInView<HTMLDivElement>({
    enabled: shaderAllowed && mode === "visible",
    rootMargin,
  });

  const idleReady = useIdleTrigger(shaderAllowed && mode === "idle", 900);

  const shouldMount =
    shaderAllowed &&
    (mode === "immediate" || (mode === "idle" && idleReady) || (mode === "visible" && inView));

  return (
    <div ref={ref} className={className} style={style} aria-hidden="true">
      {!shouldMount ? (
        fallback ?? null
      ) : props.kind === "grain" ? (
        <GrainGradient {...props.shaderProps} />
      ) : (
        <Dithering {...props.shaderProps} />
      )}
    </div>
  );
}
