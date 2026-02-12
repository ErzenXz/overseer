import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Integrations from "@/components/Integrations";
import Architecture from "@/components/Architecture";
import Skills from "@/components/Skills";
import Security from "@/components/Security";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="bg-dark min-h-screen">
      <Navbar />
      <Hero />

      {/* Divider */}
      <div className="section-divider mx-6 max-w-7xl lg:mx-auto" />

      <Features />

      <div className="section-divider mx-6 max-w-7xl lg:mx-auto" />

      <Integrations />

      <div className="section-divider mx-6 max-w-7xl lg:mx-auto" />

      <Architecture />

      <div className="section-divider mx-6 max-w-7xl lg:mx-auto" />

      <Skills />

      <div className="section-divider mx-6 max-w-7xl lg:mx-auto" />

      <Security />

      <div className="section-divider mx-6 max-w-7xl lg:mx-auto" />

      <CTA />

      <Footer />
    </main>
  );
}
