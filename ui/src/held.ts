// A start the hub held back: the person's guardrail saved it as a scheduled
// session that begins when the plan limit resets (POST /api/threads answers
// 202 with { held: true, scheduled }).

export interface HeldStart {
  held: true
  scheduled: { id: string; title: string; startsAt: number }
  message?: string
}

export const isHeld = (value: unknown): value is HeldStart =>
  !!value && typeof value === 'object' && (value as { held?: unknown }).held === true

export class HeldError extends Error {
  held: HeldStart
  constructor(held: HeldStart) {
    super(held.message || 'Held by your guardrail until the limit resets')
    this.held = held
  }
}
