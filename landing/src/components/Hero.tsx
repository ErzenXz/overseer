"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Terminal, ChevronRight } from "lucide-react";

import LazyShader from "./LazyShader";
import HeroMock from "@/components/HeroMock";

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Grain Gradient Background */}
      <div className="absolute inset-0 z-0">
        <LazyShader
          kind="grain"
          mode="idle"
          className="absolute inset-0"
          fallback={<div className="h-full w-full hero-fallback" />}
          shaderProps={{
            style: { width: "100%", height: "100%" },
            colors: ["#c6750c", "#beae60", "#d7cbc6"],
            colorBack: "#000a0f",
            softness: 0.7,
            intensity: 0.15,
            noise: 0.5,
            shape: "wave",
            speed: 1,
            scale: 1,
            rotation: 0,
            offsetX: 0,
            offsetY: 0,
          }}
        />
      </div>

      {/* Dithering Overlay */}
      <div className="absolute inset-0 z-1 opacity-20 mix-blend-screen pointer-events-none">
        <LazyShader
          kind="dither"
          mode="idle"
          className="absolute inset-0"
          shaderProps={{
            style: { width: "100%", height: "100%" },
            colorBack: "#00000000",
            colorFront: "#47a8e1",
            shape: "swirl",
            type: "8x8",
            size: 2,
            speed: 1,
            scale: 1,
            rotation: 0,
            offsetX: 0,
            offsetY: 0,
          }}
        />
      </div>

      {/* Radial fade overlay */}
      <div className="absolute inset-0 z-2 bg-[radial-gradient(ellipse_at_center,transparent_0%,#000a0f_70%)] opacity-40" />

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 z-2 bg-linear-to-t from-dark to-transparent" />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-28 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          {/* Left */}
          <div className="text-center lg:text-left">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="inline-flex items-center gap-2 mb-8"
            >
              <div className="flex items-center gap-2 px-4 py-2 rounded-full glass text-sm text-text-secondary">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
                </span>
                Open Source &middot; MIT Licensed
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </div>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="text-5xl sm:text-6xl md:text-7xl lg:text-7xl xl:text-8xl font-display font-normal leading-[0.95] tracking-tight mb-6"
            >
              <span className="block text-text-primary">Your server,</span>
              <span className="block mt-2">
                <span className="hero-title-gradient">governed by AI</span>
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.38 }}
              className="max-w-2xl mx-auto lg:mx-0 text-lg sm:text-xl text-text-secondary leading-relaxed mb-10"
            >
              A self-hosted AI agent platform that turns your server into an intelligent
              assistant. Chat via{" "}
              <span className="text-text-primary font-medium">Telegram</span>,{" "}
              <span className="text-text-primary font-medium">Discord</span>, or{" "}
              <span className="text-text-primary font-medium">Web</span> — with 20+ LLM
              providers and extensible skills.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 mb-10"
            >
              <Link
                href="https://github.com/ErzenXz/overseer#-quick-start"
                target="_blank"
                className="group flex items-center gap-2.5 px-8 py-4 bg-accent text-dark font-semibold rounded-xl hover:bg-accent/90 transition-all duration-300 shadow-lg shadow-accent/20 hover:shadow-accent/30 hover:shadow-xl"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200" />
              </Link>
              <Link
                href="https://docs.overseer.sh"
                target="_blank"
                className="group flex items-center gap-2.5 px-8 py-4 glass rounded-xl hover:bg-white/5 transition-all duration-300 text-text-primary font-medium"
              >
                <Terminal className="w-5 h-5 text-accent" />
                Read the Docs
              </Link>
            </motion.div>

            {/* Install command */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.62 }}
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
              <span className="text-text-muted group-hover:text-text-secondary transition-colors text-xs ml-2">
                click to copy
              </span>
            </motion.div>

            {/* Quick stats */}
            <div className="mt-10 grid grid-cols-3 gap-3 max-w-lg mx-auto lg:mx-0">
              <div className="hero-stat">
                <div className="hero-stat__value">20+</div>
                <div className="hero-stat__label">LLM providers</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat__value">3</div>
                <div className="hero-stat__label">chat surfaces</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat__value">∞</div>
                <div className="hero-stat__label">skills & tools</div>
              </div>
            </div>
          </div>

          {/* Right */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.32 }}
            className="flex items-center justify-center lg:justify-end"
          >
            <HeroMock />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
