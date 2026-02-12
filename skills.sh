#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Overseer Skills Helper

Usage:
  ./skills.sh list          List all skills from DB
  ./skills.sh active        List active skills from DB
  ./skills.sh sync          Sync built-in skills from skills/ directory
  ./skills.sh stats         Print skill statistics
  ./skills.sh clear-cache   Clear in-memory skill caches

Notes:
  - Security scanning runs during sync/import via registry safeguards.
  - Run from project root (or via full path).
EOF
}

run_tsx() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm tsx "$@"
  else
    npx tsx "$@"
  fi
}

cmd="${1:-}"

case "$cmd" in
  list)
    run_tsx -e "import('./src/agent/skills/registry.ts').then(m=>{const r=m.default||m;console.log(JSON.stringify(r.getAllSkills(), null, 2));})"
    ;;
  active)
    run_tsx -e "import('./src/agent/skills/registry.ts').then(m=>{const r=m.default||m;console.log(JSON.stringify(r.getActiveSkills(), null, 2));})"
    ;;
  sync)
    run_tsx -e "import('./src/agent/skills/registry.ts').then(m=>{const r=m.default||m;r.syncBuiltinSkills(); console.log('✅ Built-in skills synced');})"
    ;;
  stats)
    run_tsx -e "import('./src/agent/skills/registry.ts').then(m=>{const r=m.default||m;console.log(JSON.stringify(r.getSkillStats(), null, 2));})"
    ;;
  clear-cache)
    run_tsx -e "import('./src/agent/skills/registry.ts').then(m=>{const r=m.default||m;r.clearSkillCaches(); console.log('✅ Skill caches cleared');})"
    ;;
  *)
    usage
    exit 1
    ;;
esac
