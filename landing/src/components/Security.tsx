"use client";

import { motion } from "framer-motion";
import {
  Lock,
  Eye,
  Server,
  Shield,
  Key,
  FileWarning,
} from "lucide-react";

const securityPoints = [
  {
    icon: Lock,
    title: "AES-256-GCM Encryption",
    description: "All API keys and secrets encrypted at rest with military-grade encryption.",
  },
  {
    icon: Key,
    title: "Session Authentication",
    description: "Bcrypt password hashing with secure session management and expiry.",
  },
  {
    icon: Eye,
    title: "Complete Audit Trail",
    description: "Every action, command, and decision logged with full traceability.",
  },
  {
    icon: Shield,
    title: "Whitelist Control",
    description: "Only approved users can interact. Unauthorized access automatically blocked.",
  },
  {
    icon: FileWarning,
    title: "Dangerous Command Detection",
    description: "Risky operations require explicit confirmation before execution.",
  },
  {
    icon: Server,
    title: "Self-Hosted & Private",
    description: "Your data never leaves your server. No telemetry, no tracking, no cloud dependency.",
  },
];

export default function Security() {
  return (
    <section className="relative py-32 px-6 cv-auto">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-mono uppercase tracking-widest text-green-400 bg-green-400/10 rounded-full mb-6">
            Security
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-display leading-tight mb-6">
            Security{" "}
            <span className="text-green-400 italic">by default</span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-text-secondary">
            Enterprise-grade security baked in from day one. Your server, your rules,
            your data.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {securityPoints.map((point, i) => (
            <motion.div
              key={point.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="group p-6 rounded-2xl bg-dark-card border border-dark-border hover:border-green-500/20 transition-all duration-500"
            >
              <div className="w-11 h-11 rounded-xl bg-green-500/10 flex items-center justify-center mb-5 group-hover:bg-green-500/15 transition-colors duration-300">
                <point.icon className="w-5 h-5 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                {point.title}
              </h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {point.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
