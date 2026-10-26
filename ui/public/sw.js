// Overseer's service worker does one job: show notifications where the page
// can't (phones) and bring you to the session when you tap one. It caches
// nothing and never touches network requests.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (open) {
      await open.focus()
      open.postMessage({ type: 'overseer:open', url })
    } else {
      await self.clients.openWindow(url)
    }
  })())
})
