import { Reveal } from "../lib/reveal";

const DEVICES = [
  { name: "MacBook Pro", sub: "macOS · launchd" },
  { name: "Homelab", sub: "Linux · systemd" },
  { name: "Workstation", sub: "Windows · Scheduled Task" },
  { name: "Cloud VM", sub: "Linux · systemd" },
];

const STEPS = [
  {
    title: "Install one hub",
    body: "It serves the web UI, the API and the join scripts from a single port, with SQLite for storage. No other services to run.",
  },
  {
    title: "Paste one command per machine",
    body: "Each device dials out to the hub over one WebSocket, so it works behind NAT and firewalls. No SSH keys, no port forwarding.",
  },
  {
    title: "Everything rides that connection",
    body: "Terminals, stats, files, the remote desktop and agent sessions are multiplexed over it. Close the tab and the work keeps going.",
  },
];

function Node({
  x,
  y,
  w,
  h,
  title,
  sub,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx="12"
        fill="var(--elev)"
        stroke="var(--line-strong)"
      />
      <text
        x={x + 18}
        y={y + h / 2 - 4}
        fontSize="15"
        fontWeight="600"
        fill="var(--ink)"
      >
        {title}
      </text>
      <text x={x + 18} y={y + h / 2 + 15} fontSize="12.5" fill="var(--ink-3)">
        {sub}
      </text>
    </g>
  );
}

function Hub({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cx = x + 26;
  const cy = y + 34;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="16" fill="var(--inverse)" />
      <g
        transform={`translate(${cx - 10} ${cy - 10}) scale(0.625)`}
        fill="var(--on-inverse)"
      >
        <circle
          cx="16"
          cy="16"
          r="13"
          fill="none"
          stroke="var(--on-inverse)"
          strokeWidth="3"
        />
        <circle cx="16" cy="16" r="5.5" />
        <circle cx="25" cy="7" r="3.5" />
      </g>
      <text
        x={x + 46}
        y={cy + 5}
        fontSize="16"
        fontWeight="600"
        fill="var(--on-inverse)"
      >
        Overseer hub
      </text>
      <text
        x={x + 18}
        y={y + h - 38}
        fontSize="12.5"
        fill="var(--on-inverse)"
        opacity="0.7"
      >
        Web UI · API · MCP
      </text>
      <text
        x={x + 18}
        y={y + h - 18}
        fontSize="12.5"
        fill="var(--on-inverse)"
        opacity="0.7"
      >
        SQLite · one port
      </text>
    </g>
  );
}

function Link({ d, marker }: { d: string; marker: string }) {
  return (
    <g fill="none">
      <path
        d={d}
        stroke="var(--line-strong)"
        strokeWidth="1.5"
        markerEnd={`url(#${marker})`}
      />
      <path d={d} stroke="var(--ink-3)" strokeWidth="1.5" className="flow" />
    </g>
  );
}

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="7"
        markerHeight="7"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-3)" />
      </marker>
    </defs>
  );
}

function WideDiagram() {
  const hub = { x: 420, y: 140, w: 230, h: 140 };
  const dx = 860;
  const dw = 210;
  const dh = 66;
  const ys = [24, 124, 230, 330];
  return (
    <svg
      viewBox="0 0 1090 420"
      className="hidden h-auto w-full md:block"
      role="img"
      aria-labelledby="arch-wide-title arch-wide-desc"
    >
      <title id="arch-wide-title">How Overseer connects</title>
      <desc id="arch-wide-desc">
        Your browser talks to the hub over HTTPS and WebSocket. Each device,
        behind its own NAT or firewall, opens one outbound WebSocket to the hub.
        Nothing connects inbound to the devices.
      </desc>
      <Defs id="arrow-wide" />
      {/* browser -> hub */}
      <Link marker="arrow-wide" d={`M 230 210 L ${hub.x - 4} 210`} />
      <text
        x="325"
        y="196"
        fontSize="12"
        textAnchor="middle"
        fill="var(--ink-3)"
        fontFamily="var(--font-mono)"
      >
        HTTPS + WebSocket
      </text>
      <Node
        x={20}
        y={177}
        w={210}
        h={66}
        title="Your browser"
        sub="Desk or phone"
      />

      {/* firewall line */}
      <line
        x1="790"
        y1="10"
        x2="790"
        y2="410"
        stroke="var(--line-strong)"
        strokeDasharray="2 5"
      />
      <text
        x="800"
        y="410"
        fontSize="11.5"
        fill="var(--ink-3)"
        fontFamily="var(--font-mono)"
      >
        NAT / firewall
      </text>

      {/* devices dial out -> hub */}
      {ys.map((y, i) => (
        <Link
          marker="arrow-wide"
          key={i}
          d={`M ${dx} ${y + dh / 2} C ${dx - 110} ${y + dh / 2}, ${hub.x + hub.w + 90} ${210 + (i - 1.5) * 18}, ${hub.x + hub.w + 4} ${210 + (i - 1.5) * 18}`}
        />
      ))}
      <text
        x="735"
        y="104"
        fontSize="12"
        textAnchor="middle"
        fill="var(--ink-3)"
        fontFamily="var(--font-mono)"
      >
        dial out
      </text>
      {ys.map((y, i) => (
        <Node
          key={DEVICES[i].name}
          x={dx}
          y={y}
          w={dw}
          h={dh}
          title={DEVICES[i].name}
          sub={DEVICES[i].sub}
        />
      ))}

      <Hub {...hub} />
    </svg>
  );
}

function TallDiagram() {
  const hub = { x: 70, y: 150, w: 220, h: 120 };
  const pos = [
    { x: 24, y: 384 },
    { x: 184, y: 384 },
    { x: 24, y: 466 },
    { x: 184, y: 466 },
  ];
  const w = 152;
  const mid = hub.y + hub.h / 2;
  // Front row climbs straight up; back row runs up the outer margins into
  // the hub's sides, so no line crosses a card.
  const paths = [
    `M 100 ${pos[0].y} C 100 330, 150 320, 150 ${hub.y + hub.h + 4}`,
    `M 260 ${pos[1].y} C 260 330, 210 320, 210 ${hub.y + hub.h + 4}`,
    `M 24 ${pos[2].y + 33} C 4 ${pos[2].y + 33}, 4 ${mid}, ${hub.x - 4} ${mid}`,
    `M 336 ${pos[3].y + 33} C 356 ${pos[3].y + 33}, 356 ${mid}, ${hub.x + hub.w + 4} ${mid}`,
  ];
  return (
    <svg
      viewBox="0 0 360 544"
      className="h-auto w-full md:hidden"
      role="img"
      aria-labelledby="arch-tall-title arch-tall-desc"
    >
      <title id="arch-tall-title">How Overseer connects</title>
      <desc id="arch-tall-desc">
        Your browser talks to the hub over HTTPS and WebSocket. Each device
        opens one outbound WebSocket to the hub, so nothing connects inbound.
      </desc>
      <Defs id="arrow-tall" />
      <Link marker="arrow-tall" d={`M 180 74 L 180 ${hub.y - 4}`} />
      <text
        x="192"
        y="116"
        fontSize="11.5"
        fill="var(--ink-3)"
        fontFamily="var(--font-mono)"
      >
        HTTPS + WebSocket
      </text>
      <Node
        x={80}
        y={8}
        w={200}
        h={66}
        title="Your browser"
        sub="Desk or phone"
      />

      <line
        x1="0"
        y1="338"
        x2="360"
        y2="338"
        stroke="var(--line-strong)"
        strokeDasharray="2 5"
      />
      <text
        x="180"
        y="358"
        fontSize="11"
        textAnchor="middle"
        fill="var(--ink-3)"
        fontFamily="var(--font-mono)"
      >
        NAT / firewall
      </text>

      {paths.map((d, i) => (
        <Link marker="arrow-tall" key={i} d={d} />
      ))}
      {pos.map((p, i) => (
        <Node
          key={DEVICES[i].name}
          x={p.x}
          y={p.y}
          w={w}
          h={66}
          title={DEVICES[i].name}
          sub={DEVICES[i].sub.split(" · ")[0]}
        />
      ))}
      <Hub {...hub} />
    </svg>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how"
      aria-labelledby="how-title"
      className="border-t border-line bg-page-2 py-24 sm:py-32"
    >
      <div className="container-page">
        <Reveal className="max-w-[720px]">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title" className="h-section mt-4">
            One hub. Every machine dials in.
          </h2>
          <p className="lede mt-5 max-w-[58ch]">
            Devices connect out to the hub, never the other way round. There are
            no inbound ports to open on your laptop, your homelab or your cloud
            VMs.
          </p>
        </Reveal>

        <Reveal
          delay={0.06}
          className="mt-14 rounded-[20px] border border-line bg-page p-4 sm:p-8 lg:p-10"
        >
          <WideDiagram />
          <TallDiagram />
        </Reveal>

        <Reveal delay={0.1}>
          <ol className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.title} className="border-t border-line-strong pt-5">
                <span className="font-mono text-[12px] text-ink-3">
                  0{i + 1}
                </span>
                <h3 className="mt-2 text-[17px] font-semibold tracking-[-0.02em]">
                  {s.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-3">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}
