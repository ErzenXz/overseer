"use client";

import { motion } from "framer-motion";

import LazyShader from "./LazyShader";

const integrations = [
  { name: "OpenAI", logo: "🤖" },
  { name: "Anthropic", logo: "🧠" },
  { name: "Google", logo: "✨" },
  { name: "Groq", logo: "⚡" },
  { name: "Ollama", logo: "🦙" },
  { name: "Azure", logo: "☁️" },
  { name: "AWS", logo: "🔶" },
  { name: "Mistral", logo: "🌊" },
  { name: "xAI", logo: "🔮" },
  { name: "DeepSeek", logo: "🔍" },
  { name: "Perplexity", logo: "🎯" },
  { name: "Cohere", logo: "🔗" },
  { name: "Together", logo: "🤝" },
  { name: "Fireworks", logo: "🎆" },
  { name: "DeepInfra", logo: "🏗️" },
];

const platforms = [
  {
    name: "Telegram",
    icon: "💬",
    description: "Full streaming responses, rich formatting, file uploads",
    color: "from-blue-400 to-cyan-400",
  },
  {
    name: "Discord",
    icon: "🎮",
    description: "Server integration, slash commands, role-based access",
    color: "from-indigo-400 to-purple-400",
  },
  {
    name: "Web Dashboard",
    icon: "🌐",
    description: "Real-time chat, conversation history, tool browser",
    color: "from-accent to-cyan-300",
  },
  {
    name: "REST API",
    icon: "⚙️",
    description: "Programmatic access for custom integrations",
    color: "from-warm to-warm-light",
  },
];

export default function Integrations() {
  return (
    <section id="integrations" className="relative py-32 px-6 overflow-hidden cv-auto">
      {/* Decorative dithering background */}
      <div className="absolute top-0 right-0 w-96 h-96 opacity-10 pointer-events-none">
        <LazyShader
          kind="dither"
          mode="visible"
          className="absolute inset-0"
          shaderProps={{
            style: { width: "100%", height: "100%" },
            colorBack: "#00000000",
            colorFront: "#47a8e1",
            shape: "sphere",
            type: "4x4",
            size: 3,
            speed: 0.5,
            scale: 0.8,
          }}
        />
      </div>

      <div className="mx-auto max-w-7xl relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-mono uppercase tracking-widest text-warm bg-warm/10 rounded-full mb-6">
            Integrations
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-display leading-tight mb-6">
            Connect to{" "}
            <span className="text-warm italic">everything</span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-text-secondary">
            20+ LLM providers, multi-platform chat interfaces, and unlimited
            expansion via MCP servers.
          </p>
        </motion.div>

        {/* Platform Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-20">
          {platforms.map((platform, i) => (
            <motion.div
              key={platform.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="group relative p-6 rounded-2xl bg-dark-card border border-dark-border hover:border-dark-border-hover transition-all duration-500 overflow-hidden"
            >
              <div
                className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-linear-to-br ${platform.color} opacity-0 group-hover:opacity-[0.08] blur-3xl transition-opacity duration-700`}
              />
              <div className="text-3xl mb-4">{platform.icon}</div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                {platform.name}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {platform.description}
              </p>
            </motion.div>
          ))}
        </div>

        {/* LLM Provider Marquee */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <p className="text-center text-sm text-text-muted mb-6 font-mono uppercase tracking-widest">
            Supported LLM Providers
          </p>
          <div className="relative overflow-hidden py-4">
            {/* Fade edges */}
            <div className="absolute left-0 top-0 bottom-0 w-20 bg-linear-to-r from-dark to-transparent z-10" />
            <div className="absolute right-0 top-0 bottom-0 w-20 bg-linear-to-l from-dark to-transparent z-10" />

            <div className="flex animate-marquee">
              {[...integrations, ...integrations].map((item, i) => (
                <div
                  key={`${item.name}-${i}`}
                  className="flex items-center gap-2.5 px-6 py-3 mx-2 rounded-xl glass whitespace-nowrap"
                >
                  <span className="text-xl">{item.logo}</span>
                  <span className="text-sm text-text-secondary font-medium">
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
