import { ArrowRight } from "lucide-react";

export default function HeroMock() {
  return (
    <div className="hero-mock w-full max-w-xl">
      <div className="hero-mock__stack">
        {/* Terminal */}
        <div className="hero-mock__card hero-mock__terminal">
          <div className="hero-mock__chrome">
            <div className="hero-mock__dots" aria-hidden="true">
              <span className="dot dot--red" />
              <span className="dot dot--yellow" />
              <span className="dot dot--green" />
            </div>
            <div className="hero-mock__title">overseer · deploy</div>
          </div>
          <div className="hero-mock__body">
            <div className="line">
              <span className="p">$</span> curl -fsSL https://overseer.sh/install | bash
            </div>
            <div className="line muted">→ installing docker, nginx, supervisor…</div>
            <div className="line muted">→ configuring dashboard + bots…</div>
            <div className="line ok">✓ done · open http://localhost:3000</div>
          </div>
        </div>

        {/* Chat */}
        <div className="hero-mock__card hero-mock__chat">
          <div className="hero-mock__chatTop">
            <div className="pill">Agent</div>
            <div className="pill pill--accent">Streaming</div>
          </div>

          <div className="hero-mock__messages">
            <div className="msg msg--user">
              <div className="bubble">Deploy and lock down my server.</div>
            </div>
            <div className="msg msg--bot">
              <div className="bubble">
                I’ll set up nginx + firewall rules, rotate secrets, and run a security audit.
                <div className="chips">
                  <span className="chip">docker</span>
                  <span className="chip">security-audit</span>
                  <span className="chip">deploy</span>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-mock__input" aria-hidden="true">
            <div className="prompt">Ask anything…</div>
            <div className="send">
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
