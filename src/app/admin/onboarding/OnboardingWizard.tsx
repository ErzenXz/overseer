"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_INFO, type ProviderName } from "@/agent/provider-info";
import type { InterfaceType } from "@/types/database";
import type { ModelInfo } from "@/agent/provider-info";
import type { QuizAnswers } from "@/app/api/profile/generate/route";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronRightIcon, LoaderIcon, SparklesIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

// ── Types ─────────────────────────────────────────────────────────────────────

type StepId = "welcome" | "provider" | "interface" | "quiz" | "generating" | "done";

type QuizPage = 0 | 1 | 2 | 3;

const QUIZ_PAGES: Array<{ title: string; subtitle: string }> = [
 { title: "About you", subtitle: "Help me understand who I'm working with" },
 { title: "Your goals", subtitle: "What will we accomplish together?" },
 { title: "How I should respond", subtitle: "Calibrate my communication style" },
 { title: "My personality", subtitle: "Define who I am for you" },
];

const STEPS: Array<{ id: StepId; label: string }> = [
 { id: "welcome", label: "Welcome" },
 { id: "provider", label: "Provider" },
 { id: "interface", label: "Interface" },
 { id: "quiz", label: "Personalize" },
 { id: "generating", label: "Generating" },
 { id: "done", label: "Done" },
];

// ── Helper: Option card ────────────────────────────────────────────────────────

function OptionCard({
 selected,
 onClick,
 icon,
 label,
 description,
}: {
 selected: boolean;
 onClick: () => void;
 icon?: string;
 label: string;
 description?: string;
}) {
 return (
  <button
   type="button"
   onClick={onClick}
   className={cn(
    "relative flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors duration-200",
    "hover:border-primary/50 hover:shadow-sm",
    selected
     ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
     : "border-border bg-card",
   )}
  >
   {selected && (
    <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm animate-in zoom-in-50 duration-200">
     <CheckIcon className="h-3 w-3" />
    </span>
   )}
   {icon && <span className="text-2xl mb-1">{icon}</span>}
   <span className="text-sm font-semibold text-foreground tracking-tight">{label}</span>
   {description && <span className="text-xs text-muted-foreground">{description}</span>}
  </button>
 );
}

// ── CatalogProvider type (hoisted so it can be reused) ───────────────────────
interface CatalogProvider {
 id: string;
 displayName: string;
 requiresKey: boolean;
 description: string;
 npm: string;
 apiBaseUrl?: string;
 models: ModelInfo[];
 runtimeAdapter: string;
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
 return (
  <div className="space-y-2">
   <label className="block text-sm font-medium text-foreground tracking-tight">{label}</label>
   {children}
  </div>
 );
}

const INPUT_CLS =
 "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm";

const SELECT_CLS =
 "w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-200 shadow-sm appearance-none";

// ── Main component ────────────────────────────────────────────────────────────
export function OnboardingWizard() {
 const router = useRouter();
 const [stepIndex, setStepIndex] = useState(0);
 const step = STEPS[stepIndex];

 // ── Provider state ──────────────────────────────────────────────────────────
 const [providerCatalog, setProviderCatalog] = useState<CatalogProvider[]>([]);
 const [providerCatalogLoading, setProviderCatalogLoading] = useState(false);
 const [providerCatalogError, setProviderCatalogError] = useState("");

 const [providerForm, setProviderForm] = useState({
  name: "openai",
  display_name: "OpenAI",
  api_key: "",
  base_url: "",
  model: "gpt-4o",
  temperature: 0.7,
  is_default: true,
  priority: 0,
 });
 const [providerError, setProviderError] = useState("");
 const [providerSaving, setProviderSaving] = useState(false);

 const [interfaceForm, setInterfaceForm] = useState({
  type: "telegram" as InterfaceType,
  name: "My Telegram Bot",
  bot_token: "",
  allowed_users: "",
 });
 const [interfaceError, setInterfaceError] = useState("");
 const [interfaceSaving, setInterfaceSaving] = useState(false);

 // ── Quiz state ──────────────────────────────────────────────────────────────
 const [quizPage, setQuizPage] = useState<QuizPage>(0);
 const [quiz, setQuiz] = useState<QuizAnswers>({
  name: "", role: "", experience: "intermediate", primaryGoal: "mixed",
  workStyle: "deep_focus", agentName: "Overseer", tone: "casual",
  verbosity: "balanced", decisionStyle: "recommend_one",
  proactivity: "suggest_when_relevant", technicalDepth: "explain_on_request",
  uncertainty: "state_assumption", confirmations: "risky_only",
  humor: "light", empathy: "balanced", creativity: "balanced", learningStyle: "mixed",
 });

 // ── Generating state ─────────────────────────────────────────────────────────
 const [genStatus, setGenStatus] = useState("");
 const [genError, setGenError] = useState("");
 const [genDone, setGenDone] = useState(false);

 const stepProgress = useMemo(() => ((stepIndex + 1) / STEPS.length) * 100, [stepIndex]);

 const selectedCatalogProvider = useMemo(
  () => providerCatalog.find((p) => p.id === providerForm.name),
  [providerCatalog, providerForm.name],
 );

 const fallbackProviderInfo = useMemo(() => {
  const name = providerForm.name as ProviderName;
  return name in PROVIDER_INFO ? PROVIDER_INFO[name] : null;
 }, [providerForm.name]);

 useEffect(() => {
  let cancelled = false;
  const loadCatalog = async () => {
   setProviderCatalogLoading(true);
   setProviderCatalogError("");
   try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch("/api/providers/catalog", {
     cache: "no-store",
     signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
    const data = await res.json();
    const providers = (data.providers || []) as CatalogProvider[];
    if (cancelled) return;
    setProviderCatalog(providers);
    if (providers.length > 0 && !providerForm.name) {
     const first = providers[0];
     const firstModel = first.models[0];
     setProviderForm((prev) => ({
      ...prev,
      name: first.id,
      display_name: first.displayName,
      model: firstModel?.id || prev.model,
      base_url: first.apiBaseUrl || prev.base_url,
     }));
    }
   } catch (e) {
    if (cancelled) return;
    setProviderCatalogError(
     e instanceof Error ? e.message : "Failed to load provider catalog",
    );
   } finally {
    if (!cancelled) setProviderCatalogLoading(false);
   }
  };
  void loadCatalog();
  return () => {
   cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 const handleProviderChange = (name: string) => {
  const catalogEntry = providerCatalog.find((p) => p.id === name);
  if (catalogEntry) {
   const firstModel = catalogEntry.models[0];
   setProviderForm((prev) => ({
    ...prev,
    name,
    display_name: catalogEntry.displayName,
    model: firstModel?.id || prev.model,
    base_url: catalogEntry.apiBaseUrl || prev.base_url,
    api_key: "",
   }));
   return;
  }

  const staticName = name as ProviderName;
  if (staticName in PROVIDER_INFO) {
   const info = PROVIDER_INFO[staticName];
   setProviderForm((prev) => ({
    ...prev,
    name,
    display_name: info.displayName,
    model: info.models[0]?.id || prev.model,
    base_url: staticName === "ollama" ? "http://localhost:11434/v1" : "",
    api_key: "",
   }));
  }
 };

 const saveProvider = async () => {
  setProviderSaving(true);
  setProviderError("");
  try {
   const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     ...providerForm,
     config: selectedCatalogProvider
      ? {
        models_dev_provider_id: selectedCatalogProvider.id,
        provider_npm: selectedCatalogProvider.npm,
        runtime_adapter: selectedCatalogProvider.runtimeAdapter,
       }
      : undefined,
    }),
   });
   if (!res.ok) {
    const data = await res.json();
    setProviderError(data.error || "Failed to add provider");
    return false;
   }
   return true;
  } catch {
   setProviderError("Failed to add provider");
   return false;
  } finally {
   setProviderSaving(false);
  }
 };

 const saveInterface = async () => {
  if (!interfaceForm.bot_token.trim()) {
   return true;
  }
  setInterfaceSaving(true);
  setInterfaceError("");
  try {
   const res = await fetch("/api/interfaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
     type: interfaceForm.type,
     name: interfaceForm.name,
     config: {
      bot_token: interfaceForm.bot_token,
     },
     allowed_users: interfaceForm.allowed_users
      ? interfaceForm.allowed_users.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    }),
   });
   if (!res.ok) {
    const data = await res.json();
    setInterfaceError(data.error || "Failed to add interface");
    return false;
   }
   return true;
  } catch {
   setInterfaceError("Failed to add interface");
   return false;
  } finally {
   setInterfaceSaving(false);
  }
 };

 const generateProfile = useCallback(async () => {
  setGenStatus("Analyzing your answers…"); setGenError(""); setGenDone(false);
  try {
   const pvRes = await fetch("/api/chat");
   const pvData = await pvRes.json();
   const pv = pvData.providers?.find((p: { isDefault: boolean }) => p.isDefault) ?? pvData.providers?.[0];
   setGenStatus("Writing your Identity & Soul with AI…");
   const res = await fetch("/api/profile/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: quiz, providerId: pv?.id }),
   });
   if (!res.ok) { const d = await res.json().catch(() => ({})); setGenError(d.error || "Generation failed"); return false; }
   setGenStatus("Done! Your AI is fully personalized ✨");
   setGenDone(true);
   return true;
  } catch (e) { setGenError(e instanceof Error ? e.message : "Generation failed"); return false; }
 }, [quiz]);

 const handleNext = async () => {
  if (step.id === "provider") { if (!(await saveProvider())) return; }
  if (step.id === "interface") { if (!(await saveInterface())) return; }
  if (step.id === "quiz") {
   if (quizPage < 3) { setQuizPage((p) => (p + 1) as QuizPage); return; }
   setStepIndex((p) => p + 1);
   setTimeout(() => { void generateProfile(); }, 80);
   return;
  }
  if (step.id === "generating" && !genDone) return;
  if (step.id === "done") { router.push("/"); return; }
  setStepIndex((p) => Math.min(p + 1, STEPS.length - 1));
 };

 const handleBack = () => {
  if (step.id === "quiz" && quizPage > 0) { setQuizPage((p) => (p - 1) as QuizPage); return; }
  if (step.id === "generating") return;
  setStepIndex((p) => Math.max(p - 1, 0));
 };

 const q = (key: keyof QuizAnswers, value: string) => setQuiz((p) => ({ ...p, [key]: value }));


 return (
  <div className="max-w-2xl mx-auto py-8 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
   {/* Progress */}
   <div className="mb-8">
    <div className="flex items-center justify-between mb-3">
     <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
       <SparklesIcon className="h-4 w-4 text-primary-foreground" />
      </div>
      <span className="text-sm font-semibold tracking-tight">Overseer Setup</span>
     </div>
     <span className="text-xs font-medium text-muted-foreground">Step {stepIndex + 1} of {STEPS.length}</span>
    </div>
    <div className="flex gap-1.5">
     {STEPS.map((s, i) => (
      <div key={s.id} className={cn("h-1.5 flex-1 rounded-full transition-all duration-300",
       i < stepIndex ? "bg-primary" : i === stepIndex ? "bg-primary/50" : "bg-muted")} />
     ))}
    </div>
   </div>

   {/* Card */}
   <div className="rounded-2xl border border-border bg-card p-8 sm:p-10 shadow-lg shadow-black/5 space-y-8">

    {/* WELCOME */}
    {step.id === "welcome" && (
     <div className="space-y-8 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20 shadow-inner">
       <SparklesIcon className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-3">
       <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome to Overseer</h1>
       <p className="text-base text-muted-foreground max-w-[28rem] mx-auto leading-relaxed">
        Your self-hosted AI agent. Connect a model, take a quick quiz, and AI writes your personal Identity &amp; Soul profile.
       </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left pt-4">
       {[
        { icon: "🧠", title: "Smart memory", desc: "Remembers you across sessions" },
        { icon: "🎭", title: "AI-written Soul", desc: "Personality crafted just for you" },
        { icon: "🔒", title: "Private", desc: "Runs on your own server" },
       ].map((item, i) => (
        <div key={item.title} className="rounded-xl border border-border bg-background p-4 space-y-2 shadow-sm transition-all hover:shadow-md duration-200" style={{ animationDelay: `${i * 100}ms` }}>
         <div className="text-2xl mb-3">{item.icon}</div>
         <div className="text-sm font-semibold tracking-tight text-foreground">{item.title}</div>
         <div className="text-xs text-muted-foreground leading-relaxed">{item.desc}</div>
        </div>
       ))}
      </div>
     </div>
    )}

    {/* PROVIDER */}
    {step.id === "provider" && (
     <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
       <h2 className="text-xl font-bold tracking-tight text-foreground">Connect your AI model</h2>
       <p className="text-sm text-muted-foreground mt-1">Pick a provider and paste your API key.</p>
      </div>
      {providerError && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>{providerError}</div>}
      {providerCatalogError && <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-500 flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>Using built-in provider list.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
       <Field label="Provider">
        <NativeSelect value={providerForm.name} onChange={(e) => handleProviderChange(e.target.value)} className={SELECT_CLS} disabled={providerCatalogLoading}>
         {providerCatalog.length > 0
          ? providerCatalog.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)
          : Object.entries(PROVIDER_INFO).map(([k, v]) => <option key={k} value={k}>{v.displayName}</option>)
         }
        </NativeSelect>
        {providerCatalogLoading && <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5"><LoaderIcon className="w-3 h-3 animate-spin" /> Loading providers…</p>}
       </Field>
       <Field label="Model">
        {(selectedCatalogProvider?.models?.length ?? fallbackProviderInfo?.models?.length ?? 0) > 0 ? (
         <NativeSelect value={providerForm.model} onChange={(e) => setProviderForm((p) => ({ ...p, model: e.target.value }))} className={SELECT_CLS}>
          {(selectedCatalogProvider?.models || fallbackProviderInfo?.models || []).map((m) => (
           <option key={m.id} value={m.id}>{m.name}</option>
          ))}
         </NativeSelect>
        ) : (
         <Input type="text" value={providerForm.model} onChange={(e) => setProviderForm((p) => ({ ...p, model: e.target.value }))} className={INPUT_CLS} placeholder="gpt-4o" />
        )}
       </Field>
      </div>
      {(selectedCatalogProvider?.requiresKey ?? fallbackProviderInfo?.requiresKey ?? true) && (
       <Field label="API Key">
        <Input type="password" value={providerForm.api_key} onChange={(e) => setProviderForm((p) => ({ ...p, api_key: e.target.value }))} className={INPUT_CLS} placeholder="sk-…" />
       </Field>
      )}
      {(providerForm.name === "ollama" || selectedCatalogProvider?.runtimeAdapter === "openai-compatible") && (
       <Field label="Base URL">
        <Input type="text" value={providerForm.base_url} onChange={(e) => setProviderForm((p) => ({ ...p, base_url: e.target.value }))} className={INPUT_CLS} placeholder="http://localhost:11434/v1" />
       </Field>
      )}
      <Field label="Temperature">
       <Input type="number" step="0.1" min="0" max="2" value={providerForm.temperature} onChange={(e) => setProviderForm((p) => ({ ...p, temperature: parseFloat(e.target.value) }))} className={INPUT_CLS} />
      </Field>
     </div>
    )}

    {/* INTERFACE */}
    {step.id === "interface" && (
     <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
       <h2 className="text-xl font-bold tracking-tight text-foreground">Connect a chat interface</h2>
       <p className="text-sm text-muted-foreground mt-1">Optional — leave the token empty to skip.</p>
      </div>
      {interfaceError && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>{interfaceError}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
       <Field label="Platform">
        <NativeSelect value={interfaceForm.type} onChange={(e) => setInterfaceForm((p) => ({ ...p, type: e.target.value as InterfaceType }))} className={SELECT_CLS}>
         <option value="telegram">Telegram</option>
         <option value="discord">Discord</option>
        </NativeSelect>
       </Field>
       <Field label="Bot name">
        <Input type="text" value={interfaceForm.name} onChange={(e) => setInterfaceForm((p) => ({ ...p, name: e.target.value }))} className={INPUT_CLS} placeholder="My Bot" />
       </Field>
      </div>
      <Field label="Bot Token (leave empty to skip)">
       <Input type="password" value={interfaceForm.bot_token} onChange={(e) => setInterfaceForm((p) => ({ ...p, bot_token: e.target.value }))} className={INPUT_CLS} placeholder="Paste token or leave blank" />
      </Field>
      <Field label="Allowed Users (comma-separated IDs)">
       <Input type="text" value={interfaceForm.allowed_users} onChange={(e) => setInterfaceForm((p) => ({ ...p, allowed_users: e.target.value }))} className={INPUT_CLS} placeholder="123456789" />
      </Field>
     </div>
    )}

    {/* QUIZ */}
    {step.id === "quiz" && (
     <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
      <div>
       <div className="flex gap-1.5 mb-4">
        {QUIZ_PAGES.map((_, i) => (
         <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-all duration-300", i <= quizPage ? "bg-primary" : "bg-muted")} />
        ))}
       </div>
       <h2 className="text-xl font-bold tracking-tight text-foreground">{QUIZ_PAGES[quizPage].title}</h2>
       <p className="text-sm text-muted-foreground mt-1">{QUIZ_PAGES[quizPage].subtitle}</p>
      </div>

      {quizPage === 0 && (
       <div className="space-y-5">
        <Field label="What's your name?">
         <Input type="text" value={quiz.name} onChange={(e) => q("name", e.target.value)} className={INPUT_CLS} placeholder="e.g. Alex" />
        </Field>
        <Field label="Pronouns (optional)">
         <Input type="text" value={quiz.pronouns ?? ""} onChange={(e) => q("pronouns", e.target.value)} className={INPUT_CLS} placeholder="e.g. he/him" />
        </Field>
        <Field label="What do you do?">
         <Input type="text" value={quiz.role} onChange={(e) => q("role", e.target.value)} className={INPUT_CLS} placeholder="e.g. Backend engineer, Startup founder" />
        </Field>
        <Field label="Technical experience">
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
           { v: "beginner", i: "🌱", l: "Beginner", d: "Still learning" },
           { v: "intermediate", i: "⚡", l: "Intermediate", d: "Comfortable" },
           { v: "advanced", i: "🚀", l: "Advanced", d: "Deep knowledge" },
           { v: "expert", i: "🎯", l: "Expert", d: "I could teach this" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.experience === o.v} onClick={() => q("experience", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="Timezone (optional)">
         <Input type="text" value={quiz.timezone ?? ""} onChange={(e) => q("timezone", e.target.value)} className={INPUT_CLS} placeholder="e.g. Europe/Berlin" />
        </Field>
       </div>
      )}

      {quizPage === 1 && (
       <div className="space-y-6">
        <Field label="What will you mainly use me for?">
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {([
           { v: "devops", i: "🖥️", l: "DevOps & Infra", d: "VPS, deployments" },
           { v: "coding", i: "💻", l: "Coding", d: "Building software" },
           { v: "business", i: "📊", l: "Business", d: "Ops, productivity" },
           { v: "learning", i: "📚", l: "Learning", d: "Research & study" },
           { v: "research", i: "🔬", l: "Research", d: "Deep analysis" },
           { v: "mixed", i: "🌀", l: "Mixed", d: "A bit of everything" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.primaryGoal === o.v} onClick={() => q("primaryGoal", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="How do you typically work?">
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {([
           { v: "deep_focus", i: "🧘", l: "Deep focus", d: "One thing at a time" },
           { v: "multitasker", i: "🔀", l: "Multitasker", d: "Many things at once" },
           { v: "collaborative", i: "🤝", l: "Collaborative", d: "With a team" },
           { v: "structured", i: "📋", l: "Structured", d: "Plans & checklists" },
           { v: "spontaneous", i: "⚡", l: "Spontaneous", d: "Fast & iterative" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.workStyle === o.v} onClick={() => q("workStyle", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="How do you learn best?">
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
           { v: "examples", i: "💡", l: "By example", d: "Show me how" },
           { v: "concepts", i: "🧠", l: "Concepts first", d: "Explain the why" },
           { v: "hands_on", i: "🔧", l: "Hands-on", d: "Let me try" },
           { v: "mixed", i: "🎨", l: "Mixed", d: "Whatever fits" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.learningStyle === o.v} onClick={() => q("learningStyle", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
       </div>
      )}

      {quizPage === 2 && (
       <div className="space-y-6">
        <Field label="How long should my responses be?">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
           { v: "concise", i: "�", l: "Concise", d: "No fluff, just answers" },
           { v: "balanced", i: "⚖️", l: "Balanced", d: "Context when needed" },
           { v: "detailed", i: "�", l: "Detailed", d: "Thorough explanations" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.verbosity === o.v} onClick={() => q("verbosity", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="How should I handle uncertainty?">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
           { v: "ask_first", i: "❓", l: "Ask first", d: "Clarify before acting" },
           { v: "state_assumption", i: "🤔", l: "Assume & state", d: "Guess but tell me" },
           { v: "just_do_it", i: "⚡", l: "Just do it", d: "Make the best guess" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.uncertainty === o.v} onClick={() => q("uncertainty", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="When making decisions:">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
           { v: "give_options", i: "🔀", l: "Give options", d: "Show me paths" },
           { v: "recommend_one", i: "⭐", l: "Recommend one", d: "Pick the best" },
           { v: "decide_for_me", i: "�", l: "Decide for me", d: "Just handle it" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.decisionStyle === o.v} onClick={() => q("decisionStyle", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="When should I ask for confirmation?">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
           { v: "always", i: "🛡️", l: "Always", d: "For any action" },
           { v: "risky_only", i: "⚠️", l: "Risky only", d: "For destructive actions" },
           { v: "never", i: "🏎️", l: "Never", d: "Full autonomy" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.confirmations === o.v} onClick={() => q("confirmations", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
       </div>
      )}

      {quizPage === 3 && (
       <div className="space-y-6">
        <Field label="What should we name me?">
         <Input type="text" value={quiz.agentName} onChange={(e) => q("agentName", e.target.value)} className={INPUT_CLS} placeholder="e.g. Overseer" />
        </Field>
        <Field label="Tone of voice">
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {([
           { v: "professional", i: "�", l: "Professional", d: "Formal & polite" },
           { v: "casual", i: "☕", l: "Casual", d: "Friendly & relaxed" },
           { v: "direct", i: "🎯", l: "Direct", d: "Straight to the point" },
           { v: "friendly", i: "👋", l: "Friendly", d: "Warm & encouraging" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.tone === o.v} onClick={() => q("tone", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="Humor level">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
           { v: "none", i: "�", l: "None", d: "Strictly business" },
           { v: "light", i: "🙂", l: "Light", d: "Occasional joke" },
           { v: "playful", i: "🥳", l: "Playful", d: "Fun & witty" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.humor === o.v} onClick={() => q("humor", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
        <Field label="Empathy & Support">
         <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
           { v: "objective", i: "🤖", l: "Objective", d: "Facts only" },
           { v: "balanced", i: "🤝", l: "Balanced", d: "Helpful but professional" },
           { v: "nurturing", i: "❤️", l: "Nurturing", d: "Highly supportive" },
          ] as const).map((o) => <OptionCard key={o.v} selected={quiz.empathy === o.v} onClick={() => q("empathy", o.v)} icon={o.i} label={o.l} description={o.d} />)}
         </div>
        </Field>
       </div>
      )}
     </div>
    )}

    {/* GENERATING */}
    {step.id === "generating" && (
     <div className="space-y-8 text-center py-8 animate-in fade-in zoom-in-95 duration-500">
      {genError ? (
       <>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20">
         <svg className="w-10 h-10 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
        </div>
        <div className="space-y-2">
         <h2 className="text-xl font-bold text-foreground">Generation Failed</h2>
         <p className="text-sm text-destructive max-w-md mx-auto">{genError}</p>
        </div>
        <button onClick={() => generateProfile()} className="inline-flex items-center justify-center px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors shadow-sm">
         Try Again
        </button>
       </>
      ) : genDone ? (
       <>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
         <CheckIcon className="w-10 h-10 text-emerald-500" />
        </div>
        <div className="space-y-2">
         <h2 className="text-xl font-bold text-foreground">All Set!</h2>
         <p className="text-sm text-muted-foreground max-w-md mx-auto">{genStatus}</p>
        </div>
       </>
      ) : (
       <>
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
         <LoaderIcon className="w-10 h-10 text-primary animate-spin" />
        </div>
        <div className="space-y-2">
         <h2 className="text-xl font-bold text-foreground">Personalizing...</h2>
         <p className="text-sm text-muted-foreground animate-pulse max-w-md mx-auto">{genStatus}</p>
        </div>
       </>
      )}
     </div>
    )}

    {/* DONE */}
    {step.id === "done" && (
     <div className="space-y-8 text-center py-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20 shadow-inner">
       <SparklesIcon className="h-10 w-10 text-emerald-500" />
      </div>
      <div className="space-y-3">
       <h1 className="text-3xl font-bold tracking-tight text-foreground">You're ready to go</h1>
       <p className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed">
        Overseer is set up. You can tweak your settings later in the Dashboard. Let's start chatting!
       </p>
       <p className="text-sm text-muted-foreground mt-2">Overseer is configured and ready. Start chatting!</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-left text-sm">
       {[
        { icon: "💬", title: "Chat now", desc: "Head to the main chat interface" },
        { icon: "⚙️", title: "Settings", desc: "Add more providers or interfaces" },
       ].map((item) => (
        <div key={item.title} className="rounded-xl border border-border bg-background p-4 space-y-1">
         <p className="font-semibold text-foreground">{item.icon} {item.title}</p>
         <p className="text-muted-foreground text-xs">{item.desc}</p>
        </div>
       ))}
      </div>
     </div>
    )}
   </div>

   {/* Navigation */}
   <div className="flex items-center justify-between mt-8 pt-6 border-t border-border/50">
    <button
     onClick={handleBack}
     disabled={stepIndex === 0 || step.id === "generating"}
     className={cn(
      "flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200",
      stepIndex === 0 || step.id === "generating" || step.id === "done"
       ? "invisible opacity-0"
       : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border shadow-sm"
     )}
    >
     Back
    </button>
    <button
     onClick={handleNext}
     disabled={providerSaving || interfaceSaving || (step.id === "generating" && !genDone)}
     className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:pointer-events-none"
    >
     {providerSaving || interfaceSaving ? (
      <><LoaderIcon className="h-4 w-4 animate-spin" /> Saving…</>
     ) : step.id === "done" ? (
      "Go to Dashboard"
     ) : step.id === "quiz" && quizPage < 3 ? (
      <>Next <ChevronRightIcon className="h-4 w-4" /></>
     ) : step.id === "quiz" && quizPage === 3 ? (
      "Generate Profile"
     ) : step.id === "generating" ? (
      genDone ? <>Continue <ChevronRightIcon className="h-4 w-4" /></> : "Generating…"
     ) : (
      <>Continue <ChevronRightIcon className="h-4 w-4" /></>
     )}
    </button>
   </div>
  </div>
 );
}
