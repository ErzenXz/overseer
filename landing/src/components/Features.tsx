"use client";

import { motion } from "framer-motion";
import {
  Terminal,
  MessageSquare,
  Shield,
  Puzzle,
  Cpu,
  Globe,
  Bot,
  Layers,
} from "lucide-react";

const features = [
  {
    icon: Terminal,
    title: "Agentic Tool Loop",
    description:
      "Powered by Vercel AI SDK's tool loop for complex, multi-step reasoning and autonomous task execution.",
    accent: "from-accent to-blue-400",
  },
  {
    icon: MessageSquare,
    title: "Multi-Platform Chat",
    description:
      "Seamlessly chat via Telegram, Discord, or the built-in web interface with full streaming responses.",
    accent: "from-green-400 to-emerald-400",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description:
      "AES-256 encryption, bcrypt auth, command whitelisting, dangerous command detection, and full audit logging.",
    accent: "from-warm to-warm-light",
  },
  {
    icon: Puzzle,
    title: "Skills System",
    description:
      "Install pre-built skills or create custom ones — security audits, deployments, database helpers, and more.",
    accent: "from-purple-400 to-pink-400",
  },
  {
    icon: Cpu,
    title: "20+ LLM Providers",
    description:
      "OpenAI, Anthropic, Google, Groq, Ollama, Azure, AWS Bedrock, Mistral, xAI — swap models on the fly.",
    accent: "from-cyan-400 to-accent",
  },
  {
    icon: Globe,
    title: "MCP Integration",
    description:
      "Connect to Model Context Protocol servers for unlimited tool expansion and capabilities.",
    accent: "from-warm-light to-cream",
  },
  {
    icon: Bot,
    title: "Sub-Agents",
    description:
      "Spawn specialized agents dynamically — deploy, security audit, database optimization, and more.",
    accent: "from-rose-400 to-orange-400",
  },
  {
    icon: Layers,
    title: "Beautiful Dashboard",
    description:
      "Modern Next.js admin panel with real-time chat, conversation history, tool browser, and system metrics.",
    accent: "from-indigo-400 to-accent",
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export default function Features() {
  return (
    <section id="features" className="relative py-32 px-6 cv-auto">
      <div className="mx-auto max-w-7xl">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-mono uppercase tracking-widest text-accent bg-accent/10 rounded-full mb-6">
            Capabilities
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-display leading-tight mb-6">
            Everything you need to
            <br />
            <span className="text-accent italic">command your server</span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-text-secondary">
            From natural language shell commands to automated deployments — Overseer
            gives you superpowers without the complexity.
          </p>
        </motion.div>

        {/* Feature Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={cardVariants}
              className="group relative p-6 rounded-2xl bg-dark-card border border-dark-border hover:border-dark-border-hover transition-all duration-500 cursor-default overflow-hidden"
            >
              {/* Gradient glow on hover */}
              <div
                className={`absolute -top-20 -right-20 w-40 h-40 rounded-full bg-linear-to-br ${feature.accent} opacity-0 group-hover:opacity-[0.06] blur-3xl transition-opacity duration-700`}
              />

              <div
                className={`w-11 h-11 rounded-xl bg-linear-to-br ${feature.accent} flex items-center justify-center mb-5 shadow-lg`}
              >
                <feature.icon className="w-5 h-5 text-dark" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
