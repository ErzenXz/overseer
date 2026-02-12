"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Terminal } from "lucide-react";

import LazyShader from "./LazyShader";

export default function CTA() {
  return (
    <section className="relative py-32 px-6 overflow-hidden cv-auto">
      {/* Shader Background */}
      <div className="absolute inset-0 z-0 opacity-70">
        <LazyShader
          kind="grain"
          mode="visible"
          className="absolute inset-0"
          fallback={<div className="h-full w-full cta-fallback" />}
          shaderProps={{
            style: { width: "100%", height: "100%" },
            colors: ["#c6750c", "#47a8e1", "#beae60"],
            colorBack: "#000a0f",
            softness: 0.8,
            intensity: 0.1,
            noise: 0.4,
            shape: "blob",
            speed: 0.5,
            scale: 1.2,
          }}
        />
      </div>

      <div className="absolute inset-0 z-1 bg-dark/60" />

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-display leading-tight mb-8">
            Ready to take
            <br />
            <span className="text-accent italic">command?</span>
          </h2>
          <p className="max-w-xl mx-auto text-lg text-text-secondary mb-12">
            Deploy Overseer in minutes. Open source, self-hosted, and completely
            under your control. No vendor lock-in, no data sharing.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
            <Link
              href="https://github.com/ErzenXz/overseer#-quick-start"
              target="_blank"
              className="group flex items-center gap-2.5 px-8 py-4 bg-accent text-dark font-semibold rounded-xl hover:bg-accent/90 transition-all duration-300 shadow-lg shadow-accent/20"
            >
              Deploy Now
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="https://github.com/ErzenXz/overseer"
              target="_blank"
              className="group flex items-center gap-2.5 px-8 py-4 glass rounded-xl hover:bg-white/5 transition-all duration-300 font-medium"
            >
              <Terminal className="w-5 h-5 text-accent" />
              Star on GitHub
            </Link>
          </div>

          {/* Install */}
          <div
            className="inline-flex items-center gap-3 px-6 py-3 rounded-xl glass font-mono text-sm cursor-pointer group hover:border-dark-border-hover transition-colors duration-300"
            onClick={() => {
              navigator.clipboard.writeText(
                "curl -fsSL https://overseer.sh/install | bash"
              );
            }}
          >
            <span className="text-accent">$</span>
            <span className="text-text-secondary">
              curl -fsSL https://overseer.sh/install | bash
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
