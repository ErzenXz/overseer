declare module 'libfx/browser' {
  export function supportsJspi(): boolean
  export function xtermAdapter(terminal: unknown): unknown
  export function createFxTerminal(options: Record<string, unknown>): Promise<{
    interactive: Promise<void>
    exited: Promise<number>
    write(data: string): void
    resize(): void
    abort(): void
  }>
}
