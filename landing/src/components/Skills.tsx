"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

const skills = [
  {
    name: "Security Audit",
    icon: "🔐",
    description: "Scan for vulnerabilities and harden your server",
  },
  {
    name: "Deploy Assistant",
    icon: "🚀",
    description: "Automated deployment workflows and rollbacks",
  },
  {
    name: "Database Helper",
    icon: "🗄️",
    description: "SQL query assistance and optimization",
  },
  {
    name: "Docker Helper",
    icon: "🐳",
    description: "Container management and orchestration",
  },
  {
    name: "Code Review",
    icon: "🔍",
    description: "Automated code analysis and suggestions",
  },
  {
    name: "Web Search",
    icon: "🌐",
    description: "Internet search capabilities for your agent",
  },
  {
    name: "Performance Optimizer",
    icon: "⚡",
    description: "System optimization and tuning",
  },
  {
    name: "API Tester",
    icon: "🎯",
    description: "API testing, monitoring, and documentation",
  },
  {
    name: "Git Helper",
    icon: "🔧",
    description: "Advanced Git workflows and automation",
  },
];

const soulFeatures = [
  "Define personality, expertise, and conversation style",
  "Set guardrails — things your agent should never do",
  "Control risk tolerance for command execution",
  "Markdown-based — edit in any text editor",
  "Hot-reload on changes, no restart needed",
];

export default function Skills() {
  return (
    <section className="relative py-32 px-6 cv-auto">
      <div className="mx-auto max-w-7xl">
        {/* Skills Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-mono uppercase tracking-widest text-purple-400 bg-purple-400/10 rounded-full mb-6">
            Extensibility
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-display leading-tight mb-6">
            Skills &{" "}
            <span className="text-purple-400 italic">Personality</span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-text-secondary">
            Pre-built skills for common tasks, and a unique SOUL.md system to
            define your agent&apos;s personality.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-16">
          {/* Skills Grid */}
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {skills.map((skill, i) => (
              <motion.div
                key={skill.name}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="group p-5 rounded-2xl bg-dark-card border border-dark-border hover:border-dark-border-hover transition-all duration-500 cursor-default"
              >
                <div className="text-2xl mb-3">{skill.icon}</div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">
                  {skill.name}
                </h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  {skill.description}
                </p>
              </motion.div>
            ))}
          </div>

          {/* SOUL.md Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-2"
          >
            <div className="h-full p-8 rounded-2xl bg-dark-card border border-dark-border relative overflow-hidden">
              <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-purple-500/5 blur-3xl" />

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-linear-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <span className="text-white text-lg">🧬</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">
                      SOUL.md
                    </h3>
                    <p className="text-xs text-text-muted">
                      Agent personality system
                    </p>
                  </div>
                </div>

                {/* Mini code preview */}
                <div className="code-block rounded-xl p-4 mb-6 text-xs">
                  <div className="text-text-muted mb-1"># SOUL.md</div>
                  <div>
                    <span className="text-purple-400">You are</span> a senior
                    DevOps engineer
                  </div>
                  <div>
                    <span className="text-purple-400">Expertise:</span> AWS,
                    Docker, K8s
                  </div>
                  <div>
                    <span className="text-purple-400">Style:</span> Professional,
                    proactive
                  </div>
                  <div className="text-text-muted mt-1">
                    <span className="text-red-400">Never:</span> rm -rf without
                    confirm
                  </div>
                </div>

                <ul className="space-y-3">
                  {soulFeatures.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-text-secondary"
                    >
                      <Check className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
