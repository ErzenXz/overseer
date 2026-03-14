export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-16 md:px-10 md:py-24">
      <section className="relative overflow-hidden rounded-[2rem] border border-black/8 bg-white/80 px-8 py-12 shadow-[0_20px_80px_rgba(0,0,0,0.08)] backdrop-blur dark:border-white/10 dark:bg-white/5 md:px-12 md:py-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(38,153,215,0.15),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.10),transparent_24%)]" />
        <div className="relative grid gap-10 md:grid-cols-[1.3fr_0.9fr] md:items-end">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--fd-primary)]">
              Overseer Documentation
            </p>
            <h1 className="max-w-3xl text-4xl leading-none md:text-6xl">
              Clear docs for a powerful self-hosted AI workspace
            </h1>
            <p className="mt-5 max-w-2xl text-base text-fd-muted-foreground md:text-lg">
              Start fast, deploy confidently, and understand how Overseer works
              without digging through tool-specific setup guides.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="/docs"
                className="rounded-full bg-[color:var(--fd-primary)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                Open docs
              </a>
              <a
                href="/docs/quickstart"
                className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium transition hover:bg-black/4 dark:border-white/10 dark:hover:bg-white/6"
              >
                Quick start
              </a>
              <a
                href="/docs/guides/deployment"
                className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium transition hover:bg-black/4 dark:border-white/10 dark:hover:bg-white/6"
              >
                Deploy guide
              </a>
            </div>
          </div>

          <div className="grid gap-3 text-sm text-fd-muted-foreground">
            <div className="rounded-2xl border border-black/8 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="font-medium text-fd-foreground">Non-technical friendly</div>
              <p className="mt-1">Written for people who want plain-language setup steps first.</p>
            </div>
            <div className="rounded-2xl border border-black/8 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="font-medium text-fd-foreground">Vercel-ready docs app</div>
              <p className="mt-1">Deploy this folder directly on Vercel as its own Next.js project.</p>
            </div>
            <div className="rounded-2xl border border-black/8 bg-white/70 p-4 dark:border-white/10 dark:bg-white/5">
              <div className="font-medium text-fd-foreground">Same repo, cleaner structure</div>
              <p className="mt-1">The docs now live in a real Fumadocs app under <code>apps/docs</code>.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
