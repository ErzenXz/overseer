import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { agentCatalog, agentInfo, isUnread, relativeTime, threadStatusLabel } from '../agents'
import Icon, { AgentMark } from '../components/Icon'
import { Menu, MenuItem } from '../components/Menu'
import { deleteThread, useDevices, useThreads } from '../store'

type Status = 'all' | 'active' | 'waiting' | 'done' | 'failed'

export default function SessionsPage() {
  const { value: threads } = useThreads()
  const { value: devices } = useDevices()
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>('all')
  const [agent, setAgent] = useState('')
  const [machine, setMachine] = useState('')
  const onlyAutomations = params.get('filter') === 'automations'
  const navigate = useNavigate()

  const rows = useMemo(() => (threads ?? []).filter((thread) => {
    if (onlyAutomations && !thread.automationId) return false
    if (query && !`${thread.title} ${thread.cwd} ${thread.deviceName}`.toLowerCase().includes(query.toLowerCase())) return false
    if (agent && thread.agent !== agent) return false
    if (machine && thread.deviceId !== machine) return false
    if (status === 'active') return thread.status === 'working' || thread.status === 'starting'
    if (status === 'waiting') return thread.status === 'waiting'
    if (status === 'failed') return thread.status === 'error'
    if (status === 'done') return thread.status === 'idle' || thread.status === 'stopped'
    return true
  }), [threads, query, status, agent, machine, onlyAutomations])

  const counts = {
    all: threads?.length ?? 0,
    active: threads?.filter((thread) => thread.status === 'working' || thread.status === 'starting').length ?? 0,
    waiting: threads?.filter((thread) => thread.status === 'waiting').length ?? 0,
  }

  return (
    <div className="main-scroll">
      <div className="page">
        <h1 className="page-title">{onlyAutomations ? 'Automation runs' : 'Sessions'}</h1>
        <p className="page-sub">{onlyAutomations ? 'Sessions started by your automations' : 'Every agent session across your machines'}</p>
        <div className="page-toolbar">
          <div className="pill-tabs" role="tablist">
            <button role="tab" className="pill-tab" aria-selected={status === 'all'} onClick={() => setStatus('all')}>All <span className="count">{counts.all}</span></button>
            <button role="tab" className="pill-tab" aria-selected={status === 'active'} onClick={() => setStatus('active')}>Working <span className="count">{counts.active}</span></button>
            <button role="tab" className="pill-tab" aria-selected={status === 'waiting'} onClick={() => setStatus('waiting')}>Needs you <span className="count">{counts.waiting}</span></button>
            <button role="tab" className="pill-tab" aria-selected={status === 'done'} onClick={() => setStatus('done')}>Done</button>
            <button role="tab" className="pill-tab" aria-selected={status === 'failed'} onClick={() => setStatus('failed')}>Failed</button>
          </div>
          <span className="grow" />
          <label className="inline-search"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions" aria-label="Search sessions" /></label>
          <Menu placement="bottom-end" width={240} trigger={<button className={`icon-btn ${agent || machine ? 'icon-btn-active' : ''}`} aria-label="Filter"><Icon name="filter" size={19} /></button>}>
            {(close) => (
              <>
                <div className="menu-label">Agent</div>
                <MenuItem label="Any agent" checked={!agent} onClick={() => { setAgent(''); close() }} />
                {agentCatalog.map((item) => <MenuItem key={item.id} icon={<AgentMark agent={item.id} />} label={item.name} checked={agent === item.id} onClick={() => { setAgent(item.id); close() }} />)}
                <div className="menu-sep" />
                <div className="menu-label">Machine</div>
                <MenuItem label="Any machine" checked={!machine} onClick={() => { setMachine(''); close() }} />
                {(devices ?? []).map((device) => <MenuItem key={device.id} icon="monitor" label={device.name} checked={machine === device.id} onClick={() => { setMachine(device.id); close() }} />)}
              </>
            )}
          </Menu>
          <Link to="/" className="btn btn-dark"><Icon name="plus" size={16} />New session</Link>
        </div>
        <div className="list-card mt-8 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Session</th><th>Agent</th><th>Machine</th><th>Status</th><th>Updated</th><th style={{ width: 48 }} /></tr></thead>
            <tbody>
              {threads === null && <tr><td colSpan={6}><div className="skeleton h-6" /></td></tr>}
              {rows.map((thread) => {
                const label = threadStatusLabel(thread)
                return (
                  <tr key={thread.id} className="cursor-pointer" onClick={() => navigate(`/sessions/${thread.id}`)}>
                    <td style={{ maxWidth: 420 }}>
                      <div className="flex items-center gap-2 text-ink">{isUnread(thread) && <span className="dot dot-blue" />}<span className="truncate">{thread.title}</span>{thread.pr && <a href={thread.pr.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="flex items-center gap-0.5 text-[13px]" style={{ color: 'var(--purple)' }}><Icon name={thread.pr.state === 'merged' ? 'git-merge' : 'pull-request'} size={14} />#{thread.pr.number}</a>}</div>
                      <div className="truncate font-mono text-[12px] text-muted">{thread.cwd}</div>
                    </td>
                    <td><span className="flex items-center gap-2 whitespace-nowrap"><AgentMark agent={thread.agent} />{agentInfo(thread.agent).name}</span></td>
                    <td className="whitespace-nowrap">{thread.deviceName}</td>
                    <td>{label.text ? <span className={`badge ${label.tone === 'ok' ? 'badge-green' : label.tone === 'warn' ? 'badge-amber' : label.tone === 'err' ? 'badge-red' : ''}`}>{label.text}</span> : <span className="text-muted">Done</span>}</td>
                    <td className="whitespace-nowrap text-muted">{relativeTime(thread.updatedAt)}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <Menu placement="bottom-end" width={200} trigger={<button className="icon-btn" aria-label="Session actions"><Icon name="more" size={18} /></button>}>
                        {(close) => (
                          <>
                            <MenuItem icon="arrow-up-right" label="Open" to={`/sessions/${thread.id}`} onClick={close} />
                            <MenuItem icon="trash" label="Delete" danger onClick={async () => { close(); if (confirm(`Delete “${thread.title}”?`)) await deleteThread(thread.id) }} />
                          </>
                        )}
                      </Menu>
                    </td>
                  </tr>
                )
              })}
              {threads && rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted" style={{ height: 120 }}>No sessions match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
