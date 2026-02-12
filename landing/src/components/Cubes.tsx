"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";

interface CubesProps {
  gridSize?: number;
  cubeSize?: number;
  maxAngle?: number;
  radius?: number;
  easing?: string;
  duration?: { enter: number; leave: number };
  cellGap?: number | { row: number; col: number };
  borderStyle?: string;
  faceColor?: string;
  shadow?: boolean | string;
  autoAnimate?: boolean;
  rippleOnClick?: boolean;
  rippleColor?: string;
  rippleSpeed?: number;
}

export default function Cubes({
  gridSize = 10,
  cubeSize,
  maxAngle = 45,
  radius = 3,
  easing = "power3.out",
  duration = { enter: 0.3, leave: 0.6 },
  cellGap,
  borderStyle = "1px solid rgba(71, 168, 225, 0.12)",
  faceColor = "#060a10",
  shadow = false,
  autoAnimate = true,
  rippleOnClick = true,
  rippleColor = "rgba(71, 168, 225, 0.4)",
  rippleSpeed = 2,
}: CubesProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userActiveRef = useRef(false);
  const simPosRef = useRef({ x: 0, y: 0 });
  const simTargetRef = useRef({ x: 0, y: 0 });
  const pointerRef = useRef<{ row: number; col: number } | null>(null);
  const pointerRafRef = useRef<number | null>(null);

  const [inView, setInView] = useState(false);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  type CubeCache = {
    el: HTMLElement;
    r: number;
    c: number;
    faces: HTMLElement[];
  };
  const cubesRef = useRef<CubeCache[]>([]);

  const cells = Array.from({ length: gridSize });

  const colGap =
    typeof cellGap === "number"
      ? `${cellGap}px`
      : cellGap?.col !== undefined
        ? `${cellGap.col}px`
        : "5%";
  const rowGap =
    typeof cellGap === "number"
      ? `${cellGap}px`
      : cellGap?.row !== undefined
        ? `${cellGap.row}px`
        : "5%";

  const enterDur = duration.enter;
  const leaveDur = duration.leave;

  const tiltAt = useCallback(
    (rowCenter: number, colCenter: number) => {
      const cubes = cubesRef.current;
      if (cubes.length === 0) return;

      for (const cube of cubes) {
        const dist = Math.hypot(cube.r - rowCenter, cube.c - colCenter);
        if (dist <= radius) {
          const pct = 1 - dist / radius;
          const angle = pct * maxAngle;
          gsap.to(cube.el, {
            duration: enterDur,
            ease: easing,
            overwrite: true,
            rotateX: -angle,
            rotateY: angle,
          });
        } else {
          gsap.to(cube.el, {
            duration: leaveDur,
            ease: "power3.out",
            overwrite: true,
            rotateX: 0,
            rotateY: 0,
          });
        }
      }
    },
    [radius, maxAngle, enterDur, leaveDur, easing]
  );

  const flushPointer = useCallback(() => {
    const p = pointerRef.current;
    if (!p) return;
    tiltAt(p.row, p.col);
    simPosRef.current = { x: p.col, y: p.row };
    simTargetRef.current = { x: p.col, y: p.row };
  }, [tiltAt]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!sceneRef.current) return;
      userActiveRef.current = true;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      const rect = sceneRef.current.getBoundingClientRect();
      const cellW = rect.width / gridSize;
      const cellH = rect.height / gridSize;
      const colCenter = (e.clientX - rect.left) / cellW;
      const rowCenter = (e.clientY - rect.top) / cellH;

      pointerRef.current = { row: rowCenter, col: colCenter };
      if (pointerRafRef.current == null) {
        pointerRafRef.current = requestAnimationFrame(() => {
          pointerRafRef.current = null;
          flushPointer();
        });
      }

      idleTimerRef.current = setTimeout(() => {
        userActiveRef.current = false;
      }, 2000);
    },
    [flushPointer, gridSize]
  );

  const resetAll = useCallback(() => {
    const cubes = cubesRef.current;
    if (cubes.length === 0) return;
    for (const cube of cubes) {
      gsap.to(cube.el, {
        duration: leaveDur,
        rotateX: 0,
        rotateY: 0,
        ease: "power3.out",
      });
    }
  }, [leaveDur]);

  const onMouseLeave = useCallback(() => {
    resetAll();
  }, [resetAll]);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      if (!rippleOnClick || !sceneRef.current) return;
      const rect = sceneRef.current.getBoundingClientRect();
      const cellW = rect.width / gridSize;
      const cellH = rect.height / gridSize;
      const colHit = Math.floor((e.clientX - rect.left) / cellW);
      const rowHit = Math.floor((e.clientY - rect.top) / cellH);

      for (const cube of cubesRef.current) {
        const dist = Math.hypot(cube.r - rowHit, cube.c - colHit);
        const delay = dist * (0.05 / rippleSpeed);
        const animDuration = 0.4 / rippleSpeed;
        const holdTime = 0.15;
        gsap.to(cube.faces, {
          backgroundColor: rippleColor,
          duration: animDuration,
          delay,
          ease: "power3.out",
        });
        gsap.to(cube.faces, {
          backgroundColor: faceColor,
          duration: animDuration,
          delay: delay + animDuration + holdTime,
          ease: "power3.out",
        });
      }
    },
    [rippleOnClick, gridSize, faceColor, rippleColor, rippleSpeed]
  );

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const list: CubeCache[] = [];
    scene.querySelectorAll(".cube").forEach((node) => {
      const el = node as HTMLElement;
      const r = Number(el.dataset.row);
      const c = Number(el.dataset.col);
      const faces = Array.from(el.querySelectorAll(".cube-face")) as HTMLElement[];
      list.push({ el, r, c, faces });
    });
    cubesRef.current = list;
  }, [gridSize]);

  useEffect(() => {
    if (!autoAnimate || !sceneRef.current) return;
    if (!inView) return;
    if (prefersReducedMotion) return;

    simPosRef.current = {
      x: Math.random() * gridSize,
      y: Math.random() * gridSize,
    };
    simTargetRef.current = {
      x: Math.random() * gridSize,
      y: Math.random() * gridSize,
    };
    const speed = 0.02;
    const loop = (t: number) => {
      // Cap work to ~30fps to reduce CPU without noticeably changing the look.
      if (t - lastTickRef.current >= 33) {
        lastTickRef.current = t;
        if (!userActiveRef.current) {
          const pos = simPosRef.current;
          const target = simTargetRef.current;
          pos.x += (target.x - pos.x) * speed;
          pos.y += (target.y - pos.y) * speed;
          if (Math.hypot(target.x - pos.x, target.y - pos.y) < 0.2) {
            simTargetRef.current = {
              x: Math.random() * gridSize,
              y: Math.random() * gridSize,
            };
          }
          tiltAt(pos.y, pos.x);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [autoAnimate, gridSize, inView, prefersReducedMotion, tiltAt]);

  const sceneStyle: React.CSSProperties = {
    gridTemplateColumns: cubeSize
      ? `repeat(${gridSize}, ${cubeSize}px)`
      : `repeat(${gridSize}, 1fr)`,
    gridTemplateRows: cubeSize
      ? `repeat(${gridSize}, ${cubeSize}px)`
      : `repeat(${gridSize}, 1fr)`,
    columnGap: colGap,
    rowGap: rowGap,
  };

  const wrapperStyle: React.CSSProperties & Record<string, string> = {
    "--cube-face-border": borderStyle,
    "--cube-face-bg": faceColor,
    "--cube-face-shadow":
      shadow === true
        ? "0 0 6px rgba(0,0,0,.5)"
        : (shadow as string) || "none",
    ...(cubeSize
      ? {
          width: `${gridSize * cubeSize}px`,
          height: `${gridSize * cubeSize}px`,
        }
      : {}),
  };

  return (
    <div ref={wrapperRef} className="cubes-animation" style={wrapperStyle}>
      <div
        ref={sceneRef}
        className="cubes-animation--scene"
        style={sceneStyle}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
      >
        {cells.map((_, r) =>
          cells.map((__, c) => (
            <div key={`${r}-${c}`} className="cube" data-row={r} data-col={c}>
              <div className="cube-face cube-face--top" />
              <div className="cube-face cube-face--bottom" />
              <div className="cube-face cube-face--left" />
              <div className="cube-face cube-face--right" />
              <div className="cube-face cube-face--front" />
              <div className="cube-face cube-face--back" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
