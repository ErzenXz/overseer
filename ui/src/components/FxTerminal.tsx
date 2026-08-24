import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { execProject } from '../api'
import { fxConfigStore, fxOAuthStore, fxPromptHistoryStore, fxSessionStore } from '../lib/fxStorage'
import type { Device, ExecResult, Project } from '../types'

type FxRuntime = {
  interactive: Promise<void>
  exited: Promise<number>
  write(data: string): void
  resize(): void
  abort(): void
}

export default function FxTerminal({ project, device }: { project: Project; device?: Device }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<FxRuntime | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'failed'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host || !device?.online) return

    const wasmWithJspi = WebAssembly as typeof WebAssembly & {
      Suspending?: unknown
      promising?: unknown
    }
    if (typeof wasmWithJspi.Suspending !== 'function' || typeof wasmWithJspi.promising !== 'function') {
      setState('unsupported')
      return
    }

    let disposed = false
    setState('loading')
    setError('')

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      lineHeight: 1.45,
      letterSpacing: 0.15,
      fontFamily: "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace",
      scrollback: 20_000,
      allowProposedApi: true,
      theme: {
        background: '#151719',
        foreground: '#d7d9dc',
        cursor: '#ffb86a',
        cursorAccent: '#151719',
        selectionBackground: '#344050',
        black: '#202326',
        red: '#ff7c85',
        green: '#77d9ab',
        yellow: '#f2c879',
        blue: '#82aaff',
        magenta: '#c792ea',
        cyan: '#75d7e8',
        white: '#d7d9dc',
        brightBlack: '#686d73',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    fit.fit()

    const resizeObserver = new ResizeObserver(() => {
      fit.fit()
      runtimeRef.current?.resize()
    })
    resizeObserver.observe(host)

    const virtualRoot = `/projects/${project.id}`
    const workspace = {
      info: {
        version: 1,
        root: virtualRoot,
        cwd: virtualRoot,
        home: '/home/liveagent',
        gitAvailable: false,
        ephemeral: true,
      },
      permission: 'prompt',
      async exec({
        command,
        signal,
        timeoutMs,
        outputLimitBytes,
      }: {
        command: string
        cwd: string
        signal?: AbortSignal
        timeoutMs: number
        outputLimitBytes: number
      }) {
        const result = await execProject(project.id, command, timeoutMs, signal) as ExecResult
        return {
          stdout: utf8Limit(result.stdout, outputLimitBytes),
          stderr: utf8Limit(result.stderr, outputLimitBytes),
          exitCode: result.exitCode,
        }
      },
    }

    void import('libfx/browser').then(({ createFxTerminal, xtermAdapter }) => createFxTerminal({
        terminal: xtermAdapter(terminal),
        workspace,
        oauthSessionStore: fxOAuthStore,
        sessionStore: fxSessionStore,
        promptHistoryStore: fxPromptHistoryStore,
        configStore: fxConfigStore,
        openUrl(url: string) {
          return window.open(url, '_blank', 'noopener,noreferrer') !== null
        },
        onEvent(event: { type?: string }) {
          if (event.type === 'runtime.ready' && !disposed) setState('ready')
        },
      })).then(async (runtime) => {
      if (disposed) {
        runtime.abort()
        return
      }
      runtimeRef.current = runtime
      await runtime.interactive
      if (!disposed) {
        setState('ready')
        terminal.focus()
      }
    }).catch((cause) => {
      if (disposed) return
      setState('failed')
      setError(cause instanceof Error ? cause.message : 'fx could not start')
    })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      runtimeRef.current?.abort()
      runtimeRef.current = null
      terminal.dispose()
    }
  }, [device?.id, device?.online, project.id, project.updatedAt])

  if (!device?.online) {
    return (
      <TerminalNotice
        title={`${device?.name ?? 'This machine'} is offline`}
        body="Reconnect the machine or move this project to an online node. Your fx session is safe in this browser."
      />
    )
  }

  if (state === 'unsupported') {
    return (
      <TerminalNotice
        title="This browser cannot run embedded fx"
        body="Open LiveAgent in Chrome or Edge 137+ with WebAssembly JSPI enabled. Fleet terminals remain available on the device pages."
      />
    )
  }

  if (state === 'failed') {
    return <TerminalNotice title="fx could not start" body={error} />
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#151719]">
      <div ref={hostRef} className="fx-terminal-host h-full w-full px-3 py-4 sm:px-5" />
      {state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-[#151719] text-xs text-zinc-500">
          <span className="flex items-center gap-2"><span className="spinner" />Booting fx runtime…</span>
        </div>
      )}
    </div>
  )
}

function TerminalNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full min-h-80 place-items-center bg-[#151719] p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] font-mono text-sm text-amber-200">fx</span>
        <h2 className="mt-4 text-base font-semibold text-zinc-200">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
      </div>
    </div>
  )
}

function utf8Limit(value: string, maxBytes: number) {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length <= maxBytes) return value
  return new TextDecoder().decode(bytes.slice(0, maxBytes))
}
