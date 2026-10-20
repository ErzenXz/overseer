import { effectiveModel, effortsFor, modeOf, useAgentOptions, useAgentsOn } from '../agentOptions'
import { agentInfo, useAgentCatalog } from '../agents'
import type { AgentOptions, ModeKind } from '../types'
import type { ComposerSettings } from './Composer'
import Icon, { AgentMark, type IconName } from './Icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Submenu, SwitchMark } from './Menu'

export const modeIcons: Record<ModeKind, IconName> = {
  readonly: 'eye',
  plan: 'list-checks',
  ask: 'shield',
  edits: 'edit',
  auto: 'sparkles',
  full: 'zap',
}

// AgentPicker is one compact menu for *who* does the work: the agent, its
// model, how hard it thinks, and its fast tier. Each agent shows only what
// its CLI supports on that machine.
export function AgentPicker({ settings, onSettings, lockAgent }: { settings: ComposerSettings; onSettings: (next: ComposerSettings) => void; lockAgent?: boolean }) {
  const options = useAgentOptions(settings.deviceId, settings.agent)
  const installed = useAgentsOn(settings.deviceId)
  const info = agentInfo(settings.agent)
  const model = effectiveModel(options, settings.model)
  const selectedModel = model?.id ?? ''
  const efforts = effortsFor(options, settings.model)
  const effort = efforts.find((item) => item.id === settings.effort)
  const title = model && model.id ? model.label : info.name
  const version = installed?.find((entry) => entry.id === settings.agent)?.version

  const pickAgent = (agent: string) => onSettings({ ...settings, agent, model: '', effort: '', fast: false, mode: '' })
  const pickModel = (id: string) => {
    const allowed = options.models.find((item) => item.id === id)?.efforts
    const keep = !allowed || !settings.effort || allowed.includes(settings.effort)
    onSettings({ ...settings, model: id, effort: keep ? settings.effort : '' })
  }
  const catalog = useAgentCatalog()
  // Everything the machine has, known or found through the ACP registry.
  const ready = catalog.filter((item) => installed === null ? item.source !== 'registry' && item.source !== 'custom' : installed.find((entry) => entry.id === item.id)?.installed)
  const more = installed === null ? 0 : catalog.length - ready.length

  return (
    <Menu
      placement="top-start"
      width={268}
      trigger={
        <button type="button" className="ctl" title="Agent, model and thinking">
          <AgentMark agent={settings.agent} size={15} />
          <span>{title}</span>
          {effort && <span className="ctl-sub">{effort.label}</span>}
          {settings.fast && options.fast && <Icon name="zap" size={13} className="ctl-fast" />}
          <Icon name="chevron-down" size={12} className="ctl-chev" />
        </button>
      }
    >
      {(close) => (
        <>
          {lockAgent ? (
            <div className="menu-label flex items-center gap-2"><AgentMark agent={settings.agent} size={14} />{info.name}{version && <span className="ml-auto text-faint">{version}</span>}</div>
          ) : (
            <Submenu icon={<AgentMark agent={settings.agent} size={16} />} label={info.name} end={version} width={240}>
              {ready.map((item) => (
                <MenuItem key={item.id} icon={<AgentMark agent={item.id} size={16} />} label={item.name} end={installed?.find((entry) => entry.id === item.id)?.version} checked={item.id === settings.agent} onClick={() => { pickAgent(item.id); close() }} />
              ))}
              {more > 0 && (
                <>
                  <MenuSeparator />
                  <MenuItem icon="plus" label="More agents…" end={<span className="text-faint">{more}</span>} to="/settings/agents" onClick={close} />
                </>
              )}
            </Submenu>
          )}
          <MenuSeparator />
          <MenuLabel>Model</MenuLabel>
          {options.models.map((item) => (
            <button key={item.id || 'default'} type="button" role="menuitemradio" aria-checked={selectedModel === item.id} className="menu-item" title={item.description} onClick={() => { pickModel(item.id); close() }}>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {selectedModel === item.id && <Icon name="check" size={15} className="text-ink" />}
            </button>
          ))}
          {(efforts.length > 0 || options.fast) && <MenuSeparator />}
          {efforts.length > 0 && (
            <Submenu icon="brain" label="Thinking" end={effort?.label ?? 'Auto'} width={250}>
              <MenuItem label="Auto" description="The model's own default" checked={!effort} onClick={() => { onSettings({ ...settings, effort: '' }); close() }} />
              {efforts.map((item) => (
                <MenuItem key={item.id} label={item.label} description={item.description} checked={effort?.id === item.id} onClick={() => { onSettings({ ...settings, effort: item.id }); close() }} />
              ))}
            </Submenu>
          )}
          {options.fast && (
            <button type="button" role="menuitemcheckbox" aria-checked={!!settings.fast} className="menu-item" title={options.fast.description} onClick={() => onSettings({ ...settings, fast: !settings.fast })}>
              <Icon name="zap" size={18} className={settings.fast ? 'ctl-fast' : ''} />
              <span className="min-w-0 flex-1 truncate">{options.fast.label}</span>
              <SwitchMark checked={!!settings.fast} />
            </button>
          )}
        </>
      )}
    </Menu>
  )
}

// ModePicker sets *how much* the agent may do on its own. Modes come from the
// agent itself, so Claude Code, Codex and ACP agents each show their own.
export function ModePicker({ settings, onSettings }: { settings: ComposerSettings; onSettings: (next: ComposerSettings) => void }) {
  const options = useAgentOptions(settings.deviceId, settings.agent)
  const current = modeOf(options, settings.mode)
  if (!current) return null
  return (
    <Menu
      placement="top-start"
      width={320}
      trigger={
        <button type="button" className={`ctl ctl-mode ctl-mode-${current.kind}`} title="Mode (Shift+Tab to switch)">
          <Icon name={modeIcons[current.kind]} size={14} />
          <span>{current.label}</span>
          <Icon name="chevron-down" size={12} className="ctl-chev" />
        </button>
      }
    >
      {(close) => (
        <>
          <div className="menu-label flex items-center justify-between"><span>Mode</span><span className="kbd">⇧ Tab</span></div>
          {options.modes.map((mode) => (
            <button key={mode.id} type="button" role="menuitemradio" aria-checked={mode.id === current.id} className={`menu-item menu-item-two mode-item mode-item-${mode.kind}`} onClick={() => { onSettings({ ...settings, mode: mode.id }); close() }}>
              <Icon name={modeIcons[mode.kind]} size={16} />
              <span className="min-w-0 flex-1"><span className="block">{mode.label}</span><span className="menu-item-desc">{mode.description}</span></span>
              {mode.id === current.id && <span className="menu-item-end"><Icon name="check" size={15} className="text-ink" /></span>}
            </button>
          ))}
        </>
      )}
    </Menu>
  )
}

// nextMode cycles through the agent's modes (Shift+Tab, like Claude Code).
export function nextMode(options: AgentOptions, id: string | undefined) {
  const current = modeOf(options, id)
  const index = options.modes.findIndex((mode) => mode.id === current?.id)
  return options.modes[(index + 1) % options.modes.length]?.id ?? ''
}
