import { useState } from 'react'
import { recipeLink, universalRecipeLink, type Recipe } from '../recipes'
import { useShell } from '../shell'
import Icon from './Icon'
import Modal from './Modal'

// "Share as link": the recipe encoded into a URL. The recipe is the name,
// schedule, prompt and agent hints only, never a machine, folder or secret.

function LinkRow({ label, hint, value }: { label: string; hint: string; value: string }) {
  const { toast } = useShell()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const area = document.createElement('textarea')
      area.value = value
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    toast('Link copied')
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="cl-link-row">
      <span className="label">{label}</span>
      <div className="cl-link-field">
        <input className="input input-mono" readOnly value={value} aria-label={label} onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className="btn btn-outline" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={15} />{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <p className="hint">{hint}</p>
    </div>
  )
}

export function ShareRecipeModal({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  return (
    <Modal title="Share as link" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">Anyone with a link can add “{recipe.name}” to their own hub. They see the whole prompt first and choose their own machine and folder; nothing runs until they add it.</p>
      <div className="space-y-4">
        <LinkRow label="For people on this hub" value={recipeLink(recipe)} hint="Opens the import page on this hub. Works for anyone who can sign in here." />
        <LinkRow label="For any hub" value={universalRecipeLink(recipe)} hint="Opens overseer.sh, which forwards people to their own hub." />
      </div>
      <details className="cl-details">
        <summary>See exactly what the link contains</summary>
        <pre className="cl-json">{JSON.stringify(recipe, null, 2)}</pre>
        <p className="hint">No machine, folder, access setting or secret is ever included.</p>
      </details>
      <div className="modal-foot"><button className="btn btn-dark" onClick={onClose}>Done</button></div>
    </Modal>
  )
}
