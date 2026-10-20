import { useEffect, useRef } from "react";

// Morph is the hero art: a cloud of glowing points that turns as a sphere,
// then gathers into the Orbit mark (ring, core and satellite), then lets go
// again. Canvas 2D with additive blending, capped at 2x DPR, paused off-screen
// and in background tabs, and one still frame (the mark) for reduced motion.

const COUNT = 1150;
const HOLD = 4200; // ms in each shape
const MOVE = 1700; // ms to morph between shapes

interface P { sx: number; sy: number; sz: number; mx: number; my: number; mz: number; size: number; tint: number; twinkle: number }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function build(): P[] {
  const points: P[] = [];
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < COUNT; i++) {
    // sphere: a Fibonacci shell plus a light inner fill
    const shell = i % 5 !== 0;
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const depth = shell ? 1 : Math.cbrt(rand()) * 0.85;
    const sx = Math.cos(theta) * r * depth;
    const sz = Math.sin(theta) * r * depth;
    const sy = y * depth;
    // mark: 62% on the ring, 24% in the core, 14% on the satellite
    const pick = rand();
    let mx: number, my: number, tint: number;
    if (pick < 0.62) {
      // ring, with a gap where the satellite sits (upper right)
      let a = rand() * Math.PI * 2;
      const gap = -Math.PI / 4;
      if (Math.abs(Math.atan2(Math.sin(a - gap), Math.cos(a - gap))) < 0.42) a += 0.84;
      const rr = 0.78 + (rand() - 0.5) * 0.17;
      mx = Math.cos(a) * rr;
      my = Math.sin(a) * rr;
      tint = 0;
    } else if (pick < 0.86) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 0.3;
      mx = Math.cos(a) * rr;
      my = Math.sin(a) * rr;
      tint = 0;
    } else {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * 0.21;
      mx = 0.62 + Math.cos(a) * rr;
      my = -0.62 + Math.sin(a) * rr;
      tint = 1;
    }
    // a few status sprinkles: amber (needs you) and green (done)
    const sprinkle = rand();
    if (tint === 0 && sprinkle < 0.025) tint = 2;
    else if (tint === 0 && sprinkle < 0.05) tint = 3;
    points.push({ sx, sy, sz, mx, my, mz: (rand() - 0.5) * 0.12, size: 0.35 + rand() * 0.75, tint, twinkle: rand() * Math.PI * 2 });
  }
  return points;
}

export function Morph({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const points = build();
    const colors = ["190, 214, 255", "110, 168, 255", "245, 184, 74", "74, 222, 128"];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0, height = 0;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number, mix: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      const radius = Math.min(width, height) * 0.38;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const spin = now / 9000 + pointer.x * 0.6;
      const tilt = 0.32 + pointer.y * 0.25;
      const cs = Math.cos(spin), sn = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
      // the mark turns slightly too, so it reads as an object
      const mark = Math.sin(now / 2600) * 0.18 + pointer.x * 0.25;
      const mc = Math.cos(mark), ms = Math.sin(mark);
      for (const p of points) {
        // sphere position, rotated
        let x = p.sx * cs - p.sz * sn;
        let z = p.sx * sn + p.sz * cs;
        let y = p.sy * ct - z * st;
        z = p.sy * st + z * ct;
        // mark position, gently turned about the vertical axis
        const mx = p.mx * mc - p.mz * ms;
        const mz = p.mx * ms + p.mz * mc;
        x += (mx - x) * mix;
        y += (p.my - y) * mix;
        z += (mz - z) * mix;
        const persp = 1 / (1.9 - z * 0.6);
        const px = cx + x * radius * persp * 1.7;
        const py = cy + y * radius * persp * 1.7;
        const bright = (0.35 + (z + 1) * 0.32) * (0.75 + 0.25 * Math.sin(now / 700 + p.twinkle));
        const size = p.size * (0.7 + (z + 1) * 0.45);
        const rgb = colors[p.tint];
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, bright * 0.12)})`;
        ctx.beginPath();
        ctx.arc(px, py, size * 3.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, bright)})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    resize();
    if (still) {
      draw(0, 1);
      return;
    }
    let raf = 0;
    let start = performance.now();
    let visible = true;
    const loop = (now: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      const cycle = 2 * (HOLD + MOVE);
      const t = (now - start) % cycle;
      let mix: number;
      if (t < HOLD) mix = 0;
      else if (t < HOLD + MOVE) mix = ease((t - HOLD) / MOVE);
      else if (t < 2 * HOLD + MOVE) mix = 1;
      else mix = 1 - ease((t - 2 * HOLD - MOVE) / MOVE);
      draw(now, mix);
      raf = requestAnimationFrame(loop);
    };
    const run = () => { if (!raf && visible && !document.hidden) { raf = requestAnimationFrame(loop); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) run(); else stop(); });
    const ro = new ResizeObserver(() => resize());
    const onVis = () => (document.hidden ? stop() : run());
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 0.8;
      pointer.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 0.8;
    };
    io.observe(canvas);
    ro.observe(canvas);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointermove", onMove, { passive: true });
    start = performance.now();
    run();
    return () => { stop(); io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pointermove", onMove); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
