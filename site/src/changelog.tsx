import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";

import { Nav } from "./components/Nav";
import { Changelog } from "./components/Changelog";
import { Footer } from "./components/Footer";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Nav />
    <main id="main">
      <Changelog />
    </main>
    <Footer />
  </StrictMode>,
);
