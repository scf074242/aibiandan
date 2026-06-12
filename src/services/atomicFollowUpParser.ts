import type {
  RuntimeAtomicSlotBag,
  RuntimePendingAtomicContext,
} from '@/services/runtime/pendingAtomicContext'
import { parseAtomicOffset } from '@/services/atomicOffsetParser'
import { parseAtomicClockExpression } from '@/services/atomicTimeParser'

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

    if ((input.pendingContext.action === 'delete' || input.pendingContext.action === 'move') && !slots.targetTime) {
      const programPatch = this.extractProgramPatch(trimmed, normalized)
      if (programPatch?.programName) {
        slots.programName = programPatch.programName
        if (!slots.rawProgramText) {
          slots.rawProgramText = programPatch.rawProgramText
        }
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
    const contextInput = `${userInput} 节目编排`
    const parsed = parseAtomicClockExpression(contextInput)
    return parsed
      ? {
          targetTime: parsed.targetTime,
          targetTimeHint: parsed.matchedText,
        }
      : null
  }

  private extractOffsetPatch(normalized: string): { direction: 'forward' | 'backward'; offsetSeconds: number } | null {
    return parseAtomicOffset(normalized)
  }

  private extractReplacementProgramName(trimmed: string, normalized: string): string | undefined {
    const explicit = trimmed.match(/(?:替换成|替换为|换成|改成|改为)(.+)$/)?.[1]?.trim()
    const quoted = trimmed.match(/《([^》]+)》/)?.[1]?.trim()
    const bare = !/(替换|换成|改成|改为)/.test(normalized) ? this.normalizeProgramCandidate(trimmed) : undefined
    return this.normalizeProgramCandidate(explicit ?? quoted ?? bare)
  }

  private extractProgramPatch(trimmed: string, normalized: string): Partial<RuntimeAtomicSlotBag> | null {
    const quotedProgramName = trimmed.match(/《([^》]+)》/)?.[1]?.trim()
    const explicitProgramName = trimmed.match(/(?:插入节目|插入|插个|插一|添加节目|安排节目|加一条|加个节目|插个节目|来个|来一条|来一档|放个|上个|删除|删掉|移除|去掉|我要|我想要|想要|我想看|想看|要看|换成|改成)(.+)$/)?.[1]?.trim()
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
      .replace(/^(?:补充说明[:：]?|节目名|节目|栏目|这条|那条|这个|那个|我要|我想要|想要|我想看|想看|要看|来个|来一条|来一档|放个|上个|删除|删掉|移除|去掉|换成|改成|改为)+/, '')
      .replace(/(?:吧|呀|啊|呢)$/u, '')
      .trim()
    if (!normalized) return undefined
    if (/^\d{1,2}(?:[:：]\d{2})?$/.test(normalized)) return undefined
    if (/^\d{1,2}点(?:半|\d{1,2}分?)?$/.test(normalized)) return undefined
    if (/^(节目|栏目|这条|那条|这个节目|那个节目|第[一二三四五12345]个?)$/.test(normalized)) return undefined
    return normalized
  }

}

let globalAtomicFollowUpParser: AtomicFollowUpParser | null = null

export function getAtomicFollowUpParser(): AtomicFollowUpParser {
  if (!globalAtomicFollowUpParser) {
    globalAtomicFollowUpParser = new AtomicFollowUpParser()
  }
  return globalAtomicFollowUpParser
}
