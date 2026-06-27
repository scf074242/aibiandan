import { describe, expect, it } from 'vitest'

import { formatClockWithFrame, normalizeClockText } from '@/services/time/clockFormat'

describe('clockFormat', () => {
  it('normalizes clock text from ISO and short clock inputs', () => {
    expect(normalizeClockText('2026-03-25T09:30:00+08:00')).toBe('09:30:00')
    expect(normalizeClockText('9:30')).toBe('9:30:00')
    expect(normalizeClockText('09:30:15:12')).toBe('09:30:15')
  })

  it('formats foreground table clocks with a frame suffix', () => {
    expect(formatClockWithFrame('2026-03-25T09:30:00+08:00')).toBe('09:30:00:00')
    expect(formatClockWithFrame('9:30')).toBe('09:30:00:00')
  })
})
