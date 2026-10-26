import { useEffect } from 'react'
import { createResource, usePref } from './store'
import type { UpdateStatus } from './types'

// The hub checks GitHub every six hours; this only reads its answer, so a
// slow poll is plenty.
export const updateResource = createResource<UpdateStatus>('/api/updates', 10 * 60_000)

// Release versions look like v0.5.0; dev and source builds don't, and get no
// update notice.
const parse = (v: string | undefined) => {
  const m = v?.match(/^v(\d+)\.(\d+)\.(\d+)$/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
export const isRelease = (v: string | undefined) => parse(v) !== null
export function isNewer(candidate: string | undefined, current: string | undefined) {
  const a = parse(candidate), b = parse(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export interface UpdateNotice {
  // available: a newer release exists. updated: the hub moved to a newer
  // release than this browser last saw.
  kind: 'available' | 'updated'
  version: string
  current: string
  status: UpdateStatus
  installing: boolean
  dismiss: () => void
}

// useUpdateNotice decides whether to tell this browser about a release. It
// stays quiet on dev builds, on the very first visit, and for a version the
// person already dismissed.
export function useUpdateNotice(): UpdateNotice | null {
  const { value: status } = updateResource.use()
  const [dismissed, setDismissed] = usePref('update.dismissed', '')
  const [seen, setSeen] = usePref('update.lastSeen', '')
  const current = status?.currentVersion
  const release = isRelease(current)

  // Remember the version this browser last saw. First visit: just record it.
  // A rollback lowers it, so updating again later is announced again.
  useEffect(() => {
    if (!current || !release) return
    if (seen === '' || isNewer(seen, current)) setSeen(current)
  }, [current, release, seen, setSeen])

  if (!status || !current || !release) return null
  if (status.updateAvailable && isNewer(status.latestVersion, current) && status.latestVersion !== dismissed) {
    return { kind: 'available', version: status.latestVersion!, current, status, installing: status.applying, dismiss: () => setDismissed(status.latestVersion!) }
  }
  if (seen !== '' && isNewer(current, seen)) {
    return { kind: 'updated', version: current, current, status, installing: false, dismiss: () => setSeen(current) }
  }
  return null
}
