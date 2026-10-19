import { useEffect, useRef } from 'react'
import { Terminal as Xterm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { wsURL } from '../api'
import { mockEnabled } from '../mock'

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
        background: '#0d0d0d',
        foreground: '#e6e6e6',
        cursor: '#e6e6e6',
        selectionBackground: '#3a3a3a',
      },
      scrollback: 10000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()

    if (mockEnabled) {
      const cwd = '~/Projects/storefront'
      const prompt = () => term.write(`\x1b[32merzen@studio\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `)
      term.writeln('\x1b[90mOverseer demo terminal — commands are simulated.\x1b[0m')
      term.writeln('')
      prompt()
      let line = ''
      const dataSub = term.onData((data) => {
        if (data === '\r') {
          term.write('\r\n')
          const command = line.trim()
          if (command === 'clear') term.clear()
          else if (command === 'pwd') term.writeln('/Users/erzen/Projects/storefront')
          else if (command === 'whoami') term.writeln('erzen')
          else if (command === 'ls') term.writeln('README.md   package.json   src/   node_modules/')
          else if (command === 'help') term.writeln('Demo commands: help, ls, pwd, whoami, echo, clear')
          else if (command === 'echo') term.writeln('')
          else if (command.startsWith('echo ')) term.writeln(command.slice(5))
          else if (command) term.writeln(`\x1b[90mdemo: "${command}" is not available in this preview\x1b[0m`)
          line = ''
          prompt()
        } else if (data === '\x7f') {
          if (line) {
            line = line.slice(0, -1)
            term.write('\b \b')
          }
        } else if (data >= ' ') {
          line += data
          term.write(data)
        }
      })
      const resize = new ResizeObserver(() => fit.fit())
      resize.observe(host)
      return () => {
        dataSub.dispose()
        resize.disconnect()
        term.dispose()
      }
    }

    const url = `${wsURL('/api/ws/term')}?device=${encodeURIComponent(
      deviceId,
    )}&session=${encodeURIComponent(session)}&cols=${term.cols}&rows=${term.rows}`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    let closedByServer = false
    let disposed = false
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'exit') {
            closedByServer = true
            if (disposed) return
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
      if (!closedByServer && !disposed) {
        term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n')
        onExitRef.current?.('disconnected')
      }
    }

    const sendResize = () => {
      if (disposed) return
      try { fit.fit() } catch { return }
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
      disposed = true
      dataSub.dispose()
      resizeObserver.disconnect()
      ws.close()
      // xterm can still have a render frame queued; disposing on the next
      // tick avoids its "reading 'dimensions'" error.
      window.setTimeout(() => term.dispose(), 0)
    }
  }, [deviceId, session])

  return <div ref={hostRef} className="term-host h-full w-full" />
}
