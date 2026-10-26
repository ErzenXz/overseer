// DEV-ONLY MOCK for the Desktop tab. The MacBook already has a desktop; the
// Linux box offers the one-click setup (and "installs" it a few seconds after
// the terminal starts); Homelab shows the by-hand steps for GNOME on Wayland.

import type { DesktopInfo, DesktopSetup } from './types'

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })

const ready = new Set<string>(['macbook'])

const x11Steps = [
  'command -v x11vnc >/dev/null 2>&1 || { sudo apt-get update && sudo apt-get install -y x11vnc; }',
  'mkdir -p ~/.vnc && { [ -s ~/.vnc/passwd ] || x11vnc -storepasswd; }',
  'mkdir -p ~/.config/systemd/user && printf \'%s\\n\' \'[Unit]\' … > ~/.config/systemd/user/overseer-vnc.service',
  'systemctl --user daemon-reload && systemctl --user enable overseer-vnc.service && systemctl --user restart overseer-vnc.service',
  'sleep 2; systemctl --user is-active overseer-vnc.service',
]

const plans: Record<string, { info: Omit<DesktopInfo, 'available' | 'port'>; setup: DesktopSetup }> = {
  studio: {
    info: { os: 'linux', user: 'erzen' },
    setup: {
      supported: true,
      server: 'x11vnc',
      needsAdmin: true,
      summary: 'Installs x11vnc, asks you to choose a desktop password, and runs it as a background service on this machine. It only listens on localhost and starts again when you sign in.',
      steps: x11Steps,
      command: x11Steps.join(' && '),
      notes: ['Choose a desktop password when asked. You’ll type it again to connect.'],
      manual: ['Install x11vnc, then run x11vnc -storepasswd.', 'Run x11vnc -display :0 -auth guess -localhost -rfbport 5900 -rfbauth ~/.vnc/passwd -forever -shared.', 'Press Check again.'],
    },
  },
  homelab: {
    info: { os: 'linux', user: 'erzen' },
    setup: {
      supported: false,
      summary: 'GNOME on Wayland can’t be shared to localhost only, so Overseer won’t set it up for you. The easy fix is to sign in with the Xorg session. Then one click works.',
      manual: ['Log out. On the sign-in screen, open the gear menu and choose GNOME on Xorg.', 'Sign in, come back here and press Check again. Setup is one click on Xorg.'],
    },
  },
  'office-pc': {
    info: { os: 'windows' },
    setup: {
      supported: true,
      server: 'tightvnc',
      needsAdmin: true,
      summary: 'Installs TightVNC with winget, sets the password you choose, and runs it as a service that only accepts connections from this machine.',
      steps: ['$pw = Read-Host "Choose a desktop password (up to 8 letters or digits)" -AsSecureString; …', 'winget install --id GlavSoft.TightVNC --exact --silent --custom "ADDLOCAL=Server … SET_LOOPBACKONLY=1 VALUE_OF_LOOPBACKONLY=1"', 'Remove-Variable plain, pw; Start-Service tvnserver; Get-Service tvnserver'],
      command: 'Start-Service tvnserver',
      notes: ['Windows will ask for permission to install. TightVNC keeps passwords to 8 characters.'],
    },
  },
}

export function desktopRoute(method: string, path: string, body: Record<string, unknown>): Response | null {
  const probe = path.match(/^\/api\/devices\/([^/]+)\/desktop$/)
  if (method === 'GET' && probe) {
    const id = decodeURIComponent(probe[1])
    if (ready.has(id)) return json({ available: true, port: 5900, os: id === 'macbook' ? 'darwin' : undefined, user: id === 'macbook' ? 'erzen' : undefined })
    const plan = plans[id]
    return json({ available: false, port: 5900, reason: 'No VNC server is running on this machine.', ...plan?.info, setup: plan?.setup })
  }
  // Starting the setup terminal brings the desktop up a few seconds later.
  const sessions = path.match(/^\/api\/devices\/([^/]+)\/sessions$/)
  if (method === 'POST' && sessions && String(body.name ?? '').startsWith('desktop-setup')) {
    const id = decodeURIComponent(sessions[1])
    window.setTimeout(() => ready.add(id), 9000)
  }
  return null
}
