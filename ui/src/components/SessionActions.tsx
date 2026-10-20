import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { deleteThread, forkThread, patchThread, terminalsResource, usePref, useThreads } from '../store'
import { useShell } from '../shell'
import type { FleetSession, Thread } from '../types'
import { MenuItem, MenuLabel, MenuSeparator, Submenu } from './Menu'

// One list of actions for a session, shared by the row's "…" button and its
// right-click menu so both always match.
export function ThreadMenuItems({ thread, close, onRename }: { thread: Thread; close: () => void; onRename: () => void }) {
  const navigate = useNavigate()
  const { toast } = useShell()
  const { value: threads } = useThreads()
  const [, setPanel] = usePref<string>('session.panel', '')
  const folders = [...new Set((threads ?? []).map((item) => item.folder).filter((name): name is string => !!name))].sort()
  const unread = thread.updatedAt > thread.lastReadAt
  const run = (fn: () => Promise<unknown> | void, done?: string) => async () => {
    close()
    try {
      await fn()
      if (done) toast(done)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'That didn’t work')
    }
  }
  const openWith = (panel: string) => () => {
    close()
    setPanel(panel)
    navigate(`/sessions/${thread.id}`)
  }
  const moveTo = (folder: string) => run(() => patchThread(thread.id, { folder }), folder ? `Moved to ${folder}` : 'Removed from folder')
  const newFolder = () => {
    close()
    const name = prompt('Folder name')?.trim()
    if (name) patchThread(thread.id, { folder: name }).then(() => toast(`Moved to ${name}`)).catch((cause) => toast(cause.message))
  }

  return (
    <>
      <MenuItem icon={thread.pinned ? 'pin-off' : 'pin'} label={thread.pinned ? 'Unpin' : 'Pin to top'} onClick={run(() => patchThread(thread.id, { pinned: !thread.pinned }))} />
      <Submenu icon="folder" label="Folder" end={thread.folder} width={220}>
        {folders.map((name) => <MenuItem key={name} icon="folder" label={name} checked={thread.folder === name} onClick={moveTo(name)} />)}
        {folders.length > 0 && <MenuSeparator />}
        <MenuItem icon="plus" label="New folder…" onClick={newFolder} />
        {thread.folder && <MenuItem icon="close" label="Remove from folder" onClick={moveTo('')} />}
      </Submenu>
      <MenuSeparator />
      <MenuItem icon="edit" label="Rename" onClick={() => { close(); onRename() }} />
      <MenuItem icon="git-fork" label="New child session" onClick={run(async () => { const child = await forkThread(thread.id); navigate(`/sessions/${child.id}`) })} />
      <MenuItem icon="copy" label="Copy session link" onClick={run(() => navigator.clipboard?.writeText(`${location.origin}/sessions/${thread.id}`), 'Link copied')} />
      <Submenu icon="arrow-up-right" label="Open" width={220}>
        <MenuItem icon="terminal" label="Shell" onClick={openWith('shell')} />
        <MenuItem icon="presentation" label="Desktop" onClick={openWith('desktop')} />
        <MenuItem icon="folder" label="Files" onClick={openWith('files')} />
        <MenuItem icon="file-diff" label="Changes" onClick={openWith('changes')} />
        <MenuSeparator />
        <MenuItem icon="monitor" label={thread.deviceName} description="The machine it runs on" to={`/machines/${thread.deviceId}`} onClick={close} />
        {thread.pr && <MenuItem icon="pull-request" label={`Pull request #${thread.pr.number}`} href={thread.pr.url} onClick={close} />}
      </Submenu>
      <MenuItem icon={unread ? 'mail-check' : 'mail'} label={unread ? 'Mark read' : 'Mark unread'} onClick={run(() => patchThread(thread.id, { read: unread }))} />
      <MenuItem icon={thread.archived ? 'unarchive' : 'archive'} label={thread.archived ? 'Unarchive' : 'Archive'} onClick={run(() => patchThread(thread.id, { archived: !thread.archived, pinned: thread.archived ? thread.pinned : false }), thread.archived ? 'Unarchived' : 'Archived')} />
      <MenuSeparator />
      <Submenu icon="more" label="More" width={220}>
        <MenuItem icon="copy" label="Copy session ID" onClick={run(() => navigator.clipboard?.writeText(thread.id), 'ID copied')} />
        <MenuItem icon="copy" label="Copy folder path" onClick={run(() => navigator.clipboard?.writeText(thread.cwd), 'Path copied')} />
        <MenuSeparator />
        <MenuItem icon="trash" label="Delete" danger onClick={run(async () => {
          if (!confirm(`Delete “${thread.title}” and its history? The agent is stopped.`)) return
          await deleteThread(thread.id)
          if (location.pathname === `/sessions/${thread.id}`) navigate('/')
        })} />
      </Submenu>
    </>
  )
}

export function TerminalMenuItems({ session, close }: { session: FleetSession; close: () => void }) {
  const navigate = useNavigate()
  const { toast } = useShell()
  return (
    <>
      <MenuLabel>{session.deviceName}</MenuLabel>
      <MenuItem icon="terminal" label="Open terminal" onClick={() => { close(); navigate(`/machines/${session.deviceId}?tab=terminal&session=${encodeURIComponent(session.name)}`) }} />
      <MenuItem icon="copy" label="Copy name" onClick={() => { close(); navigator.clipboard?.writeText(session.name); toast('Copied') }} />
      <MenuSeparator />
      <MenuItem icon="trash" label="End terminal" danger onClick={async () => {
        close()
        if (!confirm(`End “${session.name}”? Anything running in it stops.`)) return
        await api.del(`/api/devices/${session.deviceId}/sessions/${encodeURIComponent(session.name)}`).catch(() => {})
        terminalsResource.refresh()
      }} />
    </>
  )
}
