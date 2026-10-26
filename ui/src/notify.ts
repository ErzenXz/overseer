// Notifications that work on phones too. Mobile browsers throw on
// `new Notification()`, so a registered service worker (public/sw.js) shows
// them instead; tapping one focuses Overseer and opens the session.

export function notificationsSupported() {
  return typeof Notification !== 'undefined'
}

export function notificationsAllowed() {
  return notificationsSupported() && Notification.permission === 'granted'
}

// registerNotificationWorker is best effort: without it, notifications fall
// back to the page's own Notification constructor.
export function registerNotificationWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// showNotice raises one notification. `path` is where a tap should go, and
// `tag` makes a newer notice for the same session replace the older one;
// `again` marks a reminder, which should still make a sound.
export async function showNotice(title: string, body: string, tag: string, path: string, onOpen: () => void, again = false) {
  if (!notificationsAllowed()) return
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (registration?.active) {
      // `renotify` makes a reminder alert again instead of silently replacing the first notice.
      await registration.showNotification(title, { body, tag, icon: '/icon-192.png', data: { url: path }, ...(again ? { renotify: true } : {}) } as NotificationOptions)
      return
    }
  } catch { /* fall through to the page notification */ }
  try {
    const note = new Notification(title, { body, tag, icon: '/icon-192.png', ...(again ? { renotify: true } : {}) } as NotificationOptions)
    note.onclick = () => { window.focus(); onOpen(); note.close() }
  } catch { /* unsupported (some mobile browsers) or blocked: nothing to do */ }
}
