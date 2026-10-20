import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Agents } from "./components/Agents";
import { Features } from "./components/Features";
import { Showcase } from "./components/Showcase";
import { HowItWorks } from "./components/HowItWorks";
import { Security } from "./components/Security";
import { Install } from "./components/Install";
import { FAQ } from "./components/FAQ";
import { ClosingCTA, Footer } from "./components/Footer";

export default function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-inverse px-4 py-2 text-on-inverse focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <Agents />
        <Showcase />
        <Features />
        <HowItWorks />
        <Security />
        <Install />
        <FAQ />
        <ClosingCTA />
      </main>
      <Footer />
    </>
  );
}
