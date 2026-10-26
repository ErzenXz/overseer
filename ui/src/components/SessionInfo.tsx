import { Link } from 'react-router-dom'
import { agentInfo, relativeTime } from '../agents'
import type { Device, Thread } from '../types'
import { tildePath, useFolderInfo } from '../where'
import { OsMark } from './DeviceMark'
import Icon, { AgentMark } from './Icon'
import { Menu } from './Menu'

// SessionInfo is the small "i" in a session's header. Its menu says where the
// session runs: the agent and model, the machine, the folder and its branch.
// It is read-only; a session stays where it started.
export default function SessionInfo({ thread, device }: { thread: Thread; device?: Device }) {
  const online = device ? device.online : true
  const { entry, home } = useFolderInfo(thread.deviceId, thread.cwd, online)
  const info = entry?.info
  const branch = info?.isRepo ? info.branch : undefined
  const path = tildePath(thread.cwd || '~', home)
  const agent = agentInfo(thread.agent)
  const model = [thread.model, thread.effort].filter(Boolean).join(' · ')
  return (
    <Menu
      placement="bottom-start"
      width={320}
      trigger={<button className="icon-btn" aria-label="Where this session runs" title="Agent, machine and folder"><Icon name="info" size={18} /></button>}
    >
      {(close) => (
        <div className="si">
          <div className="si-row">
            <span className="si-label">Agent</span>
            <span className="si-value"><AgentMark agent={thread.agent} size={15} />{agent.name}{model && <em>{model}</em>}</span>
          </div>
          <div className="si-row">
            <span className="si-label">Machine</span>
            <Link to={`/machines/${thread.deviceId}`} className="si-value si-link" onClick={close}>
              <OsMark os={device?.os} size={15} />{device?.name ?? thread.deviceName}{!online && <em className="si-off">offline</em>}
            </Link>
          </div>
          <div className="si-row">
            <span className="si-label">Folder</span>
            <button type="button" className="si-value si-copy" title="Copy the path" onClick={() => { navigator.clipboard?.writeText(thread.cwd || path); close() }}>
              <Icon name="folder" size={15} /><span className="si-path">{path}</span><Icon name="copy" size={13} className="si-copy-icon" />
            </button>
          </div>
          {branch && (
            <div className="si-row">
              <span className="si-label">Branch</span>
              <span className="si-value"><Icon name="git-branch" size={15} />{branch}{info?.dirty ? <em>{info.dirty} changed</em> : null}</span>
            </div>
          )}
          {thread.pr && (
            <div className="si-row">
              <span className="si-label">Pull request</span>
              <a href={thread.pr.url} target="_blank" rel="noreferrer" className="si-value si-link" onClick={close}><Icon name="pull-request" size={15} />#{thread.pr.number}</a>
            </div>
          )}
          <div className="si-row">
            <span className="si-label">Started</span>
            <span className="si-value">{relativeTime(thread.createdAt)}</span>
          </div>
        </div>
      )}
    </Menu>
  )
}
