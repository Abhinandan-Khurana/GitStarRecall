import { useState } from "react";
import { useAuth } from "../auth/useAuth";

export default function LandingPage() {
  const { beginOAuthLogin } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  const handleOAuthLogin = async () => {
    try {
      await beginOAuthLogin();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Unable to start GitHub OAuth");
    }
  };

  return (
    <section className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <p className="text-xs uppercase tracking-[0.4em] text-mist/60">
            Local-first RAG for GitHub stars
          </p>
          <h1 className="font-display text-4xl font-semibold leading-tight text-white md:text-5xl">
            GitStarRecall helps you find starred repos by memory, not by name.
          </h1>
          <p className="text-lg text-mist/80">
            Ask for tailored recommendations from your own stars based on your exact use case.
            Your data stays local, and external LLMs are opt-in only.
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => {
                void handleOAuthLogin();
              }}
              className="rounded-full bg-mint px-6 py-3 text-sm font-semibold text-ink"
            >
              Connect GitHub
            </button>
            <button className="rounded-full border border-white/20 px-6 py-3 text-sm text-mist/80">
              Watch Demo
            </button>
          </div>
          {authError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {authError}
            </div>
          ) : null}
          <div className="grid gap-3 text-sm text-mist/70 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="font-semibold text-mint">Privacy-first storage</p>
              <p>SQLite WASM + sqlite-vec keeps everything on-device.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="font-semibold text-cyan">Security-aligned</p>
              <p>OAuth PKCE, token isolation, and explicit LLM consent.</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="aspect-video w-full overflow-hidden rounded-xl border border-white/10">
            <iframe
              className="h-full w-full"
              src="https://www.youtube.com/embed/VIDEO_ID"
              title="GitStarRecall demo"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <p className="mt-3 text-xs text-mist/60">
            Demo video placeholder. Replace VIDEO_ID with the official demo.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            title: "Sync and checksum",
            body: "Incremental sync keeps 1k+ stars fresh without full re-indexing.",
          },
          {
            title: "Sessioned recall",
            body: "Each query becomes a session, so you can refine and revisit ideas.",
          },
          {
            title: "Provider optionality",
            body: "Ollama, LM Studio, or remote LLMs only when you enable them.",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-2xl border border-white/10 bg-slate/40 p-5">
            <p className="font-semibold text-white">{card.title}</p>
            <p className="mt-2 text-sm text-mist/70">{card.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
