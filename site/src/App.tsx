import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Install } from "./components/Install";
import { Capabilities } from "./components/Capabilities";
import { FleetAgents } from "./components/FleetAgents";
import { HowItWorks } from "./components/HowItWorks";
import { Exposure } from "./components/Exposure";
import { OverseerCode } from "./components/OverseerCode";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Install />
        <Capabilities />
        <FleetAgents />
        <HowItWorks />
        <Exposure />
        <OverseerCode />
      </main>
      <Footer />
    </>
  );
}
