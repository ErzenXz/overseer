import { StatsCard } from "@/components/StatsCard";
import * as skillsRegistry from "@/agent/skills/registry";
import { SkillsList } from "./SkillsList";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/permissions";
import { BoxesIcon, DownloadCloudIcon, GithubIcon, BoxIcon, ActivityIcon, PackageCheckIcon, PlayCircleIcon, InfoIcon, FolderIcon, ShoppingBagIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
 const user = await getCurrentUser();
 if (!user) {
  return <div className="text-sm text-muted-foreground">Unauthorized</div>;
 }

 const canViewAll = hasPermission(user, Permission.TENANT_VIEW_ALL);
 const allSkills = canViewAll
  ? skillsRegistry.getAllSkills()
  : skillsRegistry.getAllSkillsForUser(user.id);
 const activeSkills = canViewAll
  ? skillsRegistry.getActiveSkills()
  : skillsRegistry.getActiveSkillsForUser(user.id);
 const builtinCount = allSkills.filter(s => s.is_builtin).length;
 const totalUses = allSkills.reduce((acc, s) => acc + s.use_count, 0);

 return (
  <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
   {/* Header */}
   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div className="flex flex-col gap-1.5">
     <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Skills</h1>
      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border/50 uppercase tracking-wider">
       Capabilities
      </span>
     </div>
     <p className="text-sm text-muted-foreground flex items-center gap-1.5">
      <BoxesIcon className="w-4 h-4" />
      Modular capabilities and tools for your AI agent
     </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
     <a
      href="/admin/skills/import"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-9 px-4 w-full sm:w-auto"
     >
      <DownloadCloudIcon className="w-4 h-4" />
      Sync Built-in
     </a>
     <a
      href="/admin/skills/import"
      className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 w-full sm:w-auto"
     >
      <GithubIcon className="w-4 h-4" />
      Import from GitHub
     </a>
    </div>
   </div>

   {/* Stats Grid */}
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
    <StatsCard
     title="Total Skills"
     value={allSkills.length}
     icon={<BoxIcon className="w-5 h-5" />}
     color="accent"
    />
    <StatsCard
     title="Active Skills"
     value={activeSkills.length}
     icon={<ActivityIcon className="w-5 h-5" />}
     color="success"
    />
    <StatsCard
     title="Built-in Skills"
     value={builtinCount}
     icon={<PackageCheckIcon className="w-5 h-5" />}
     color="info"
    />
    <StatsCard
     title="Total Executions"
     value={totalUses}
     icon={<PlayCircleIcon className="w-5 h-5" />}
     color="warning"
    />
   </div>

   {/* Skills List */}
   {allSkills.length === 0 ? (
    <div className="rounded-xl border border-border bg-card shadow-sm p-12 text-center flex flex-col items-center justify-center min-h-[400px]">
     <div className="w-16 h-16 mb-6 rounded-2xl bg-muted flex items-center justify-center ring-1 ring-border/50">
      <BoxesIcon className="w-8 h-8 text-muted-foreground" />
     </div>
     <h3 className="text-lg font-semibold tracking-tight text-foreground mb-2">No skills installed</h3>
     <p className="text-sm text-muted-foreground max-w-md mb-6">
      Install skills to extend your agent with new capabilities, workflows, and tools.
     </p>
     <div className="flex justify-center gap-3">
      <a
       href="/admin/skills/import"
       className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring border border-input bg-background hover:bg-primary hover:text-accent-foreground shadow-sm h-9 px-4"
      >
       <DownloadCloudIcon className="w-4 h-4" />
       Sync Built-in Skills
      </a>
      <a
       href="/admin/skills/import"
       className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4"
      >
       <GithubIcon className="w-4 h-4" />
       Import from GitHub
      </a>
     </div>
    </div>
   ) : (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
     <SkillsList skills={allSkills} />
    </div>
   )}

   {/* Skill Sources Info */}
   <div className="rounded-xl border border-border bg-card shadow-sm p-5 md:p-6 bg-gradient-to-br from-card to-muted/20">
    <h2 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 mb-4 uppercase">
     <InfoIcon className="w-4 h-4 text-primary" />
     Skill Sources
    </h2>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
     <div className="p-4 bg-background border border-border/50 rounded-lg hover:border-blue-500/50 transition-colors group">
      <div className="flex items-center gap-2 mb-2">
       <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-md">
        <BoxIcon className="w-3.5 h-3.5" />
        BUILTIN
       </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mt-3">
       Pre-installed core skills from the framework's native registry.
      </p>
     </div>
     <div className="p-4 bg-background border border-border/50 rounded-lg hover:border-purple-500/50 transition-colors group">
      <div className="flex items-center gap-2 mb-2">
       <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 bg-purple-500/10 text-purple-500 border border-purple-500/20 rounded-md">
        <GithubIcon className="w-3.5 h-3.5" />
        GITHUB
       </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mt-3">
       Skills imported and synced directly from GitHub repositories.
      </p>
     </div>
     <div className="p-4 bg-background border border-border/50 rounded-lg hover:border-green-500/50 transition-colors group">
      <div className="flex items-center gap-2 mb-2">
       <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 bg-green-500/10 text-green-500 border border-green-500/20 rounded-md">
        <FolderIcon className="w-3.5 h-3.5" />
        LOCAL
       </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mt-3">
       Custom skills created and developed locally in the workspace.
      </p>
     </div>
     <div className="p-4 bg-background border border-border/50 rounded-lg hover:border-orange-500/50 transition-colors group">
      <div className="flex items-center gap-2 mb-2">
       <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 bg-orange-500/10 text-orange-500 border border-orange-500/20 rounded-md">
        <ShoppingBagIcon className="w-3.5 h-3.5" />
        MARKETPLACE
       </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mt-3">
       Skills downloaded from the community extension marketplace.
      </p>
     </div>
    </div>
   </div>
  </div>
 );
}
