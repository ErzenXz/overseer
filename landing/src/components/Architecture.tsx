"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";

const Cubes = dynamic(() => import("./Cubes"), { ssr: false });

const codeLines = [
  { num: 1, content: '<span class="comment">// Deploy with one command</span>' },
  { num: 2, content: '<span class="prompt">$</span> <span class="function">curl</span> <span class="operator">-fsSL</span> https://overseer.sh/install <span class="operator">|</span> <span class="function">bash</span>' },
  { num: 3, content: "" },
  { num: 4, content: '<span class="comment">// Or clone and configure</span>' },
  { num: 5, content: '<span class="prompt">$</span> <span class="function">git</span> clone https://github.com/ErzenXz/overseer' },
  { num: 6, content: '<span class="prompt">$</span> <span class="keyword">cd</span> overseer' },
  { num: 7, content: '<span class="prompt">$</span> <span class="function">pnpm</span> install' },
  { num: 8, content: '<span class="prompt">$</span> <span class="function">pnpm</span> setup' },
  { num: 9, content: "" },
  { num: 10, content: '<span class="comment">// Configure your provider</span>' },
  { num: 11, content: '<span class="prompt">$</span> <span class="keyword">export</span> <span class="variable">OPENAI_API_KEY</span><span class="operator">=</span><span class="string">"sk-..."</span>' },
  { num: 12, content: "" },
  { num: 13, content: '<span class="comment">// Launch everything</span>' },
  { num: 14, content: '<span class="prompt">$</span> <span class="function">pnpm</span> dev <span class="comment"># Web dashboard</span>' },
  { num: 15, content: '<span class="prompt">$</span> <span class="function">pnpm</span> bots:dev <span class="comment"># Telegram + Discord</span>' },
];

const archSteps = [
  {
    step: "01",
    title: "Deploy",
    description: "One-line install on any VPS. Linux, macOS, or Windows.",
  },
  {
    step: "02",
    title: "Configure",
    description: "Set your LLM provider, connect chat platforms, customize personality via SOUL.md.",
  },
  {
    step: "03",
    title: "Extend",
    description: "Add skills, connect MCP servers, spawn sub-agents for specialized tasks.",
  },
  {
    step: "04",
    title: "Command",
    description: "Chat naturally to manage your entire server infrastructure.",
  },
];

export default function Architecture() {
  return (
    <section id="architecture" className="relative py-32 px-6 cv-auto">
      <div className="mx-auto max-w-7xl">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-mono uppercase tracking-widest text-cream bg-cream/10 rounded-full mb-6">
            Architecture
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-display leading-tight mb-6">
            Built for{" "}
            <span className="text-cream italic">production</span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-text-secondary">
            Simple to deploy, powerful to extend. From single-server to
            enterprise infrastructure.
          </p>
        </motion.div>

        {/* Two Column: Code + Cubes */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-24">
          {/* Code Block */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="code-block rounded-2xl overflow-hidden">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-5 py-3.5 border-b border-dark-border">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <span className="ml-3 text-xs text-text-muted">terminal — zsh</span>
              </div>
              {/* Code content */}
              <div className="p-5 overflow-x-auto">
                {codeLines.map((line) => (
                  <div key={line.num} className="flex gap-4">
                    <span className="line-number">{line.num}</span>
                    <span
                      dangerouslySetInnerHTML={{
                        __html: line.content || "&nbsp;",
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Cubes */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex items-center justify-center"
          >
            <div className="w-full max-w-md">
              <Cubes
                gridSize={8}
                maxAngle={40}
                radius={3}
                borderStyle="1px solid rgba(71, 168, 225, 0.1)"
                faceColor="#060a10"
                rippleColor="rgba(71, 168, 225, 0.3)"
                rippleSpeed={2}
                autoAnimate={true}
                rippleOnClick={true}
              />
            </div>
          </motion.div>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {archSteps.map((step, i) => (
            <motion.div
              key={step.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="relative p-6 rounded-2xl bg-dark-card border border-dark-border group hover:border-dark-border-hover transition-all duration-500"
            >
              <span className="text-5xl font-display text-dark-border group-hover:text-accent/20 transition-colors duration-500 block mb-4">
                {step.step}
              </span>
              <h3 className="text-xl font-semibold text-text-primary mb-2">
                {step.title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
