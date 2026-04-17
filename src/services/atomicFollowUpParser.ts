import type {
  RuntimeAtomicSlotBag,
  RuntimePendingAtomicContext,
} from '@/services/runtime/pendingAtomicContext'

export interface AtomicFollowUpPatch {
  slots: Partial<RuntimeAtomicSlotBag>
}

export class AtomicFollowUpParser {
  parse(input: { pendingContext: RuntimePendingAtomicContext; userInput: string }): AtomicFollowUpPatch | null {
    const trimmed = input.userInput.trim()
    if (!trimmed) return null

    const slots: Partial<RuntimeAtomicSlotBag> = {}
    const normalized = trimmed.replace(/\s+/g, '')

    const timePatch = this.extractTimePatch(trimmed)
    if (timePatch) {
      slots.targetTime = timePatch.targetTime
      slots.targetTimeHint = timePatch.targetTimeHint
    }

    const offsetPatch = this.extractOffsetPatch(normalized)
    if (offsetPatch) {
      slots.direction = offsetPatch.direction
      slots.offsetSeconds = offsetPatch.offsetSeconds
    }

    if (input.pendingContext.action === 'replace') {
      const replacementProgramName = this.extractReplacementProgramName(trimmed, normalized)
      if (replacementProgramName) {
        slots.replacementProgramName = replacementProgramName
      }
    }

    if (input.pendingContext.action === 'insert') {
      const programPatch = this.extractProgramPatch(trimmed, normalized)
      if (programPatch) {
        Object.assign(slots, programPatch)
      }
    }

    if (input.pendingContext.action === 'delete' && !slots.targetTime) {
      const programPatch = this.extractProgramPatch(trimmed, normalized)
      if (programPatch?.programName) {
        slots.programName = programPatch.programName
      }
    }

    if (input.pendingContext.action === 'move' && !slots.targetTime && input.pendingContext.slots.targetTime) {
      slots.targetTime = input.pendingContext.slots.targetTime
      slots.targetTimeHint = input.pendingContext.slots.targetTimeHint ?? input.pendingContext.slots.targetTime
    }

    return Object.keys(slots).length > 0
      ? { slots }
      : null
  }

  private extractTimePatch(userInput: string): { targetTime: string; targetTimeHint: string } | null {
    const normalized = userInput.replace(/\s+/g, '')
    const patterns = [
      /(\d{1,2})[:：](\d{2})/,
      /(\d{1,2})点半/,
      /(\d{1,2})点(?:(\d{1,2})分?)?/,
    ]

    for (const pattern of patterns) {
      const match = pattern.exec(normalized)
      if (!match?.[0]) continue
      if (pattern.source.includes('点半')) {
        return {
          targetTime: this.normalizeTime(`${match[1]}:30`),
          targetTimeHint: match[0],
        }
      }

      return {
        targetTime: this.normalizeTime(`${match[1]}:${match[2] ?? '00'}`),
        targetTimeHint: match[0],
      }
    }

    return null
  }

  private extractOffsetPatch(normalized: string): { direction: 'forward' | 'backward'; offsetSeconds: number } | null {
    const hourOffsetMatch =
      normalized.match(/([前后])移(\d{1,2})小时/) ||
      normalized.match(/(提前|延后|顺延)(\d{1,2})小时/)
    if (hourOffsetMatch) {
      const directionToken = hourOffsetMatch[1] ?? ''
      return {
        direction: directionToken === '前' || directionToken === '提前' ? 'backward' : 'forward',
        offsetSeconds: Number(hourOffsetMatch[2] ?? '1') * 3600,
      }
    }

    const minuteOffsetMatch =
      normalized.match(/([前后])移(\d{1,2})分钟/) ||
      normalized.match(/(提前|延后|顺延)(\d{1,2})分钟/)
    if (minuteOffsetMatch) {
      const directionToken = minuteOffsetMatch[1] ?? ''
      return {
        direction: directionToken === '前' || directionToken === '提前' ? 'backward' : 'forward',
        offsetSeconds: Number(minuteOffsetMatch[2] ?? '1') * 60,
      }
    }

    return null
  }

  private extractReplacementProgramName(trimmed: string, normalized: string): string | undefined {
    const explicit = trimmed.match(/(?:替换成|替换为|换成|改成|改为)(.+)$/)?.[1]?.trim()
    const quoted = trimmed.match(/《([^》]+)》/)?.[1]?.trim()
    const bare = !/(替换|换成|改成|改为)/.test(normalized) ? this.normalizeProgramCandidate(trimmed) : undefined
    return this.normalizeProgramCandidate(explicit ?? quoted ?? bare)
  }

  private extractProgramPatch(trimmed: string, normalized: string): Partial<RuntimeAtomicSlotBag> | null {
    const quotedProgramName = trimmed.match(/《([^》]+)》/)?.[1]?.trim()
    const explicitProgramName = trimmed.match(/(?:插入节目|插入|插个|插一|添加节目|安排节目|加一条|加个节目|插个节目|我要|换成|改成)(.+)$/)?.[1]?.trim()
    const candidate = this.normalizeProgramCandidate(quotedProgramName ?? explicitProgramName ?? trimmed)
    if (!candidate) return null

    return {
      programName: candidate,
      rawProgramText: candidate,
    }
  }

  private normalizeProgramCandidate(value?: string): string | undefined {
    if (!value) return undefined
    const normalized = value
      .replace(/^[，,：:\s]+/, '')
      .replace(/[，。！？!?]/g, '')
      .replace(/^(?:补充说明[:：]?|节目名|节目|栏目|这条|那条|这个|那个|我要|换成|改成|改为)+/, '')
      .trim()
    if (!normalized) return undefined
    if (/^(节目|栏目|这条|那条|这个节目|那个节目|第[一二三四五12345]个?)$/.test(normalized)) return undefined
    return normalized
  }

  private normalizeTime(timeText: string): string {
    const match = timeText.match(/(\d{1,2})[:：]?(\d{2})?(?:[:：]?(\d{2}))?/)
    if (!match) return '09:00:00'

    const hours = (match[1] ?? '09').padStart(2, '0')
    const minutes = (match[2] ?? '00').padStart(2, '0')
    const seconds = (match[3] ?? '00').padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }
}

let globalAtomicFollowUpParser: AtomicFollowUpParser | null = null

export function getAtomicFollowUpParser(): AtomicFollowUpParser {
  if (!globalAtomicFollowUpParser) {
    globalAtomicFollowUpParser = new AtomicFollowUpParser()
  }
  return globalAtomicFollowUpParser
}
