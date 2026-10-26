import { useEffect, useMemo } from 'react'
import { useThreads } from './store'

const BASE_TITLE = 'Overseer'
const AMBER = '#e0a526'

// useWaitingCount is how many sessions are stopped on a question for you.
export function useWaitingCount() {
  const { value: threads } = useThreads()
  return useMemo(() => (threads ?? []).filter((thread) => thread.status === 'waiting' && !thread.archived).length, [threads])
}

// useTabAttention puts the waiting count in the tab title and an amber dot on
// the favicon, so a stuck agent shows up in a background tab. Both clear when
// nothing is waiting.
export function useTabAttention() {
  const count = useWaitingCount()

  useEffect(() => {
    document.title = count > 0 ? `(${count}) Waiting · ${BASE_TITLE}` : BASE_TITLE
    return () => { document.title = BASE_TITLE }
  }, [count])

  useEffect(() => {
    if (count === 0) return
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'))
    let badge: HTMLLinkElement | null = null
    let alive = true
    drawBadgedIcon().then((href) => {
      if (!alive || !href) return
      // Browsers choose between icon links on their own, so swap them out
      // while the badge is up and put them back after.
      links.forEach((link) => link.remove())
      badge = document.createElement('link')
      badge.rel = 'icon'
      badge.type = 'image/png'
      badge.href = href
      document.head.appendChild(badge)
    })
    return () => {
      alive = false
      if (badge) {
        badge.remove()
        links.forEach((link) => document.head.appendChild(link))
      }
    }
  }, [count > 0]) // eslint-disable-line react-hooks/exhaustive-deps
}

let badged: Promise<string | null> | null = null

// drawBadgedIcon paints an amber dot onto the app icon, once.
function drawBadgedIcon(): Promise<string | null> {
  badged ??= new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      try {
        const size = 64
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image, 0, 0, size, size)
        const radius = 15
        const x = size - radius - 1
        const y = size - radius - 1
        ctx.beginPath()
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = AMBER
        ctx.fill()
        resolve(canvas.toDataURL('image/png'))
      } catch { resolve(null) }
    }
    image.onerror = () => resolve(null)
    image.src = '/icon-192.png'
  })
  return badged
}
