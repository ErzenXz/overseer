import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsURL } from '../api'

// Terminal renders one xterm attached to a device session via the hub bridge.
export default function Terminal({
  deviceId,
  session,
  onExit,
}: {
  deviceId: string
  session: string
  onExit?: (error: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Xterm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        "'SF Mono', ui-monospace, 'Cascadia Code', Menlo, monospace",
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: '#334155',
      },
      scrollback: 10000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    const url = `${wsURL('/api/ws/term')}?device=${encodeURIComponent(
      deviceId,
    )}&session=${encodeURIComponent(session)}&cols=${term.cols}&rows=${term.rows}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    let closedByServer = false
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'exit') {
            closedByServer = true
            term.write('\r\n\x1b[90m[session ended')
            if (m.error) term.write(`: ${m.error}`)
            term.write(']\x1b[0m\r\n')
            onExitRef.current?.(m.error || '')
          }
        } catch {
          /* ignore */
        }
      } else {
        term.write(new Uint8Array(ev.data))
      }
    }
    ws.onclose = () => {
      if (!closedByServer) {
        term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
        onExitRef.current?.('disconnected')
      }
    }

    const sendResize = () => {
      fit.fit()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })
    const resizeObserver = new ResizeObserver(() => sendResize())
    resizeObserver.observe(host)
    ws.onopen = () => {
      term.focus()
      sendResize()
    }

    return () => {
      dataSub.dispose()
      resizeObserver.disconnect()
      ws.close()
      term.dispose()
    }
  }, [deviceId, session])

  return <div ref={hostRef} className="term-host h-full w-full bg-[#020617]" />
}
