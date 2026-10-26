import { useEffect, useRef, type RefObject } from "react";

// FleetField is the hero background: Overseer's own architecture, drawn live.
// A hub sits at the centre (the approved Overseer mark), machines ride slow orbits around
// it, and agent activity travels in as packets along curved links: grey while
// working, amber when an agent needs approval, green when a PR is ready.
// Canvas 2D, capped at 2x DPR, paused off-screen and in background tabs, and a
// single still frame for people who prefer reduced motion.

type Status = "idle" | "working" | "waiting" | "done";

interface Machine {
  orbit: number;
  angle: number;
  speed: number;
  label: string;
  status: Status;
  until: number;
}

interface Packet {
  from: Machine;
  t: number;
  speed: number;
  status: Status;
  bend: number;
}

const LABELS = [
  "studio · claude",
  "homelab · codex",
  "mbp · gemini",
  "gpu-box · devin",
  "ci-runner · opencode",
  "office-pc · copilot",
  "vps-fra · codex",
  "pi-cluster · goose",
  "mini · claude",
  "build-01 · cursor",
  "lab-nas · kimi",
  "edge-sfo · amp",
  "dev-vm · qwen",
  "render · claude",
];

const ORBITS = [0.17, 0.29, 0.42, 0.56];
const TILT = -0.2; // radians; the system leans like a disc seen from above

// anchor: an element whose middle the hub sits on (the hero keeps empty room
// for it), so wrapping text above can never push content onto the hub.
export function FleetField({ className = "", centerY = 0.66, labels = true, anchor }: { className?: string; centerY?: number; labels?: boolean; anchor?: RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) =>
      css.getPropertyValue(name).trim() || fallback;
    // Draw in the page's ink colour, so the field works on light and dark.
    const hex = color("--ink", "#ededed").replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    const ink = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0).join(", ");
    const statusColor: Record<Status, string> = {
      idle: `rgba(${ink}, 0.55)`,
      working: `rgba(${ink}, 0.9)`,
      waiting: color("--amber-dot", "#e0a526"),
      done: color("--green", "#22c55e"),
    };

    const mark = new Image();
    mark.src = "/brand/overseer.png";

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let small = false;
    let anchorY = -1;
    const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };

    // Deterministic layout so the first frame always looks composed.
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const machines: Machine[] = LABELS.map((label, i) => ({
      orbit: i % ORBITS.length,
      angle: (i / LABELS.length) * Math.PI * 2 + rand() * 0.6,
      speed: (0.018 + rand() * 0.02) * (i % 2 ? 1 : -1) * (1 / (1 + (i % ORBITS.length) * 0.5)),
      label,
      status: i % 5 === 0 ? "working" : "idle",
      until: 0,
    }));
    machines[3].status = "waiting";
    machines[7].status = "done";
    const packets: Packet[] = [];
    let hubPulse = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      small = width < 640;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const box = anchor?.current?.getBoundingClientRect();
      anchorY = box ? box.top - rect.top + box.height / 2 : -1;
    };

    const geometry = () => {
      const scale = Math.min(width, 1400) * (small ? 1.25 : 1);
      const cx = width / 2 + (pointer.x - 0.5) * 28;
      const cy = (anchorY >= 0 ? anchorY : height * (small ? centerY - 0.02 : centerY)) + (pointer.y - 0.5) * 18;
      const squash = 0.34 + (pointer.y - 0.5) * 0.06;
      return { scale, cx, cy, squash };
    };

    const position = (m: Machine, g: ReturnType<typeof geometry>) => {
      const rx = ORBITS[m.orbit] * g.scale;
      const ry = rx * g.squash;
      const x = Math.cos(m.angle) * rx;
      const y = Math.sin(m.angle) * ry;
      const cos = Math.cos(TILT);
      const sin = Math.sin(TILT);
      // depth: front of the disc (sin > 0) is closer and brighter
      return { x: g.cx + x * cos - y * sin, y: g.cy + x * sin + y * cos, depth: (Math.sin(m.angle) + 1) / 2 };
    };

    const drawOrbits = (g: ReturnType<typeof geometry>) => {
      ctx.save();
      ctx.translate(g.cx, g.cy);
      ctx.rotate(TILT);
      ORBITS.forEach((r, i) => {
        const rx = r * g.scale;
        const ry = rx * g.squash;
        // back half fainter than the front half, for depth
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${ink}, ${0.05 - i * 0.006})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, Math.PI, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${ink}, ${0.11 - i * 0.015})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI);
        ctx.stroke();
      });
      ctx.restore();
    };

    const bezier = (p0: { x: number; y: number }, p1: { x: number; y: number }, bend: number, t: number) => {
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const cx = mx - dy * bend;
      const cy = my + dx * bend;
      const u = 1 - t;
      return { x: u * u * p0.x + 2 * u * t * cx + t * t * p1.x, y: u * u * p0.y + 2 * u * t * cy + t * t * p1.y };
    };

    const drawHub = (g: ReturnType<typeof geometry>) => {
      const r = small ? 9 : 12;
      if (hubPulse > 0) {
        const p = 1 - hubPulse;
        ctx.strokeStyle = `rgba(${ink}, ${0.35 * hubPulse})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(g.cx, g.cy, r + p * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, r * 7);
      glow.addColorStop(0, `rgba(${ink}, 0.16)`);
      glow.addColorStop(1, `rgba(${ink}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, r * 7, 0, Math.PI * 2);
      ctx.fill();
      if (mark.complete && mark.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(g.cx - r * 1.4, g.cy - r * 1.4, r * 2.8, r * 2.8, r * 0.4);
        ctx.clip();
        ctx.drawImage(mark, g.cx - r * 1.4, g.cy - r * 1.4, r * 2.8, r * 2.8);
        ctx.restore();
      }
    };

    const frame = (now: number, dt: number) => {
      pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3);
      pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
      const g = geometry();
      ctx.clearRect(0, 0, width, height);
      drawOrbits(g);

      const hub = { x: g.cx, y: g.cy };
      const placed = machines.map((m) => ({ m, p: position(m, g) }));

      // links: faint spokes from every machine to the hub
      for (const { p } of placed) {
        ctx.strokeStyle = `rgba(${ink}, ${0.025 + p.depth * 0.03})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(hub.x, hub.y);
        ctx.stroke();
      }

      // packets: agent activity streaming in to the hub
      for (const packet of packets) {
        const from = position(packet.from, g);
        const tint = statusColor[packet.status];
        for (let i = 7; i >= 0; i--) {
          const t = packet.t - i * 0.022;
          if (t < 0) continue;
          const q = bezier(from, hub, packet.bend, t);
          ctx.globalAlpha = (1 - i / 8) * 0.9;
          ctx.fillStyle = tint;
          ctx.beginPath();
          ctx.arc(q.x, q.y, i === 0 ? 1.9 : 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // machines, back to front
      placed.sort((a, b) => a.p.depth - b.p.depth);
      ctx.font = `500 10.5px "Geist Mono Variable", ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      for (const { m, p } of placed) {
        const size = 2 + p.depth * 1.6;
        const tint = statusColor[m.status];
        if (m.status === "waiting" || m.status === "done") {
          const pulse = 0.5 + 0.5 * Math.sin(now / 380);
          ctx.strokeStyle = tint;
          ctx.globalAlpha = 0.25 + pulse * 0.35;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size + 4 + pulse * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = tint;
        ctx.globalAlpha = 0.35 + p.depth * 0.65;
        ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
        ctx.globalAlpha = 1;
        if (labels && width >= 820 && p.depth > 0.35) {
          const note = m.status === "waiting" ? "  needs approval" : m.status === "done" ? "  PR ready" : "";
          ctx.fillStyle = `rgba(${ink}, ${0.18 + p.depth * 0.32})`;
          ctx.fillText(m.label, p.x + size + 8, p.y);
          if (note) {
            const w = ctx.measureText(m.label).width;
            ctx.fillStyle = tint;
            ctx.globalAlpha = 0.85;
            ctx.fillText(note, p.x + size + 8 + w, p.y);
            ctx.globalAlpha = 1;
          }
        }
      }
      drawHub(g);
    };

    const step = (dt: number, now: number) => {
      for (const m of machines) {
        m.angle += m.speed * dt;
        if (m.until && now > m.until) {
          m.status = "idle";
          m.until = 0;
        }
      }
      // a new burst of activity every so often
      if (Math.random() < dt * (small ? 1.4 : 2.4)) {
        const from = machines[Math.floor(Math.random() * machines.length)];
        const roll = Math.random();
        const status: Status = roll < 0.12 ? "waiting" : roll < 0.26 ? "done" : "working";
        packets.push({ from, t: 0, speed: 0.35 + Math.random() * 0.3, status, bend: (Math.random() - 0.5) * 0.5 });
        if (from.status === "idle") {
          from.status = "working";
          from.until = now + 2600;
        }
      }
      for (let i = packets.length - 1; i >= 0; i--) {
        const packet = packets[i];
        packet.t += packet.speed * dt;
        if (packet.t >= 1) {
          packets.splice(i, 1);
          hubPulse = 1;
          if (packet.status !== "working") {
            packet.from.status = packet.status;
            packet.from.until = now + (packet.status === "waiting" ? 3800 : 3000);
          }
        }
      }
      hubPulse = Math.max(0, hubPulse - dt * 1.6);
    };

    resize();
    if (still) {
      mark.onload = () => frame(0, 0);
      frame(0, 0);
      return () => { mark.onload = null; };
    }

    let raf = 0;
    let last = performance.now();
    let visible = true;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt, now);
      frame(now, dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.tx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      pointer.ty = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    const sizer = new ResizeObserver(() => {
      resize();
      if (!raf) frame(performance.now(), 0);
    });
    observer.observe(canvas);
    sizer.observe(canvas);
    window.addEventListener("pointermove", onPointer, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      observer.disconnect();
      sizer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [centerY, labels, anchor]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
