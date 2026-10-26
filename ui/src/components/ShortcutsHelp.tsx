import { GROUPS, SHORTCUTS } from '../lib/shortcuts'
import Modal from './Modal'

// ShortcutKeys draws one shortcut's keys as small caps. "Then" ones read like
// "G" then "S" with a gap, so they don't look like a chord held together.
export function ShortcutKeys({ keys, then }: { keys: string[]; then?: boolean }) {
  return (
    <span className={`sk ${then ? 'sk-then' : ''}`}>
      {keys.map((key, index) => <kbd key={`${key}-${index}`} className="sk-key">{key}</kbd>)}
    </span>
  )
}

// ShortcutList is every shortcut, grouped. The help overlay and the settings
// page both show it.
export function ShortcutList() {
  return (
    <div className="sk-grid">
      {GROUPS.map((group) => (
        <section key={group} className="sk-group">
          <h3 className="sk-title">{group}</h3>
          {SHORTCUTS.filter((item) => item.group === group).map((item) => (
            <div key={item.id} className="sk-row"><span>{item.label}</span><ShortcutKeys keys={item.keys} then={item.then} /></div>
          ))}
        </section>
      ))}
    </div>
  )
}

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" wide onClose={onClose}>
      <ShortcutList />
      <p className="sk-note">Press <ShortcutKeys keys={['G']} /> then a letter to jump to a page. Shortcuts that use a letter alone only work when you're not typing.</p>
    </Modal>
  )
}
