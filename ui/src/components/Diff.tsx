import type { ToolFile } from '../types'
import Icon from './Icon'

export function Diff({ file }: { file: ToolFile }) {
  const lines = (file.diff ?? '').split('\n')
  return (
    <div className="diff">
      <div className="diff-head">
        <Icon name="file" size={14} />
        <span className="truncate">{file.path}</span>
        <span className="ml-auto"><span className="plus">+{file.additions ?? 0}</span> <span className="minus">−{file.deletions ?? 0}</span></span>
      </div>
      <div className="diff-body">
        {lines.map((line, index) => (
          <div key={index} className={`diff-line ${line.startsWith('@@') ? 'diff-hunk' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : ''}`}>{line || ' '}</div>
        ))}
      </div>
    </div>
  )
}
