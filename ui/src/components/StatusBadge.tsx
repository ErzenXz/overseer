const kindIcons: Record<string, string> = {
  claude: '✳',
  codex: '◆',
  shell: '❯',
}

export default function StatusBadge({
  status,
  kind,
}: {
  status: 'working' | 'idle' | 'exited'
  kind: string
}) {
  const color =
    status === 'working'
      ? 'bg-emerald-400 animate-pulse'
      : status === 'idle'
        ? 'bg-slate-500'
        : 'bg-rose-500'
  return (
    <span className="flex items-center gap-1.5" title={`${kind || 'terminal'} — ${status}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      {kind && kind !== 'shell' && (
        <span className="text-[11px] text-sky-400">{kindIcons[kind] ?? '●'}</span>
      )}
    </span>
  )
}
