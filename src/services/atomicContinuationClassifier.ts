import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'

export type AtomicSelectionReply =
  | { mode: 'ordinal'; index: number }
  | { mode: 'raw_text'; value: string }

export type AtomicContinuationDecision =
  | { kind: 'continue' }
  | { kind: 'cancel' }
  | { kind: 'interrupt_as_new_task' }
  | { kind: 'selection_reply'; selection: AtomicSelectionReply }
  | { kind: 'correction_reply'; value: string }

export class AtomicContinuationClassifier {
  classify(input: { pendingContext: RuntimePendingAtomicContext; userInput: string }): AtomicContinuationDecision {
    const normalized = input.userInput.replace(/\s+/g, '')
    if (/^(取消|不用了|算了|先不用|停止|结束|关闭)$/.test(normalized)) {
      return { kind: 'cancel' }
    }

    if (this.shouldInterruptAsNewTask(normalized)) {
      return { kind: 'interrupt_as_new_task' }
    }

    const ordinalIndex = this.resolveSelectionOrdinalIndex(normalized)
    if (ordinalIndex !== null) {
      return {
        kind: 'selection_reply',
        selection: {
          mode: 'ordinal',
          index: ordinalIndex,
        },
      }
    }

    if (input.pendingContext.phase === 'recommending_insert') {
      const correctionValue = this.resolveCorrectionValue(input.userInput)
      if (correctionValue) {
        return {
          kind: 'correction_reply',
          value: correctionValue,
        }
      }
    }

    if ((input.pendingContext.phase === 'selecting_target' || input.pendingContext.phase === 'recommending_insert')
      && this.looksLikeSelectionReply(normalized)) {
      return {
        kind: 'selection_reply',
        selection: {
          mode: 'raw_text',
          value: input.userInput.trim(),
        },
      }
    }

    return { kind: 'continue' }
  }

  private shouldInterruptAsNewTask(normalizedInput: string): boolean {
    if (/(按这个版面开始编排|按该版面开始编排|确认版面|采用这个版面|用这个版面编排)/.test(normalizedInput)) return true
    if (/(帮我全天编排|全天编排|整天编排|帮我填充全天节目|填充全天节目|补齐当前所有空窗|补齐当前空窗|补齐空窗|补齐当前所有空缺|补齐当前空缺)/.test(normalizedInput)) return true
    if (/(执行校验|请校验当前节目单|校验当前节目单|校验一下|看看有没有问题)/.test(normalizedInput)) return true
    if (/(版面|栏目|剧场|时段|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/.test(normalizedInput)) return true
    return /(\d{1,2}(?::\d{2})?点?.*)(到|至|-).*(\d{1,2}(?::\d{2})?点?)/.test(normalizedInput)
      && /(新闻|栏目|剧场|电视剧|综艺|专题|资讯|纪录片|纪实|少儿|动画)/.test(normalizedInput)
  }

  private looksLikeSelectionReply(normalizedInput: string): boolean {
    return /(这个|就这个|选这个|选它|它|那条|这一条|那一个|这个节目|那档|这档)/.test(normalizedInput)
      || /《[^》]+》/.test(normalizedInput)
  }

  private resolveSelectionOrdinalIndex(normalizedInput: string): number | null {
    const cleaned = normalizedInput.replace(/(我选|选|就|那就|吧|啊|呀|呢|节目|条|项|个)/g, '')
    const mapping: Record<string, number> = {
      第一: 0,
      第1: 0,
      一: 0,
      1: 0,
      第二: 1,
      第2: 1,
      二: 1,
      2: 1,
      第三: 2,
      第3: 2,
      三: 2,
      3: 2,
      第四: 3,
      第4: 3,
      四: 3,
      4: 3,
      第五: 4,
      第5: 4,
      五: 4,
      5: 4,
    }
    return Object.prototype.hasOwnProperty.call(mapping, cleaned) ? mapping[cleaned]! : null
  }

  private resolveCorrectionValue(userInput: string): string | null {
    const trimmed = userInput.trim()
    const quoted = trimmed.match(/《([^》]+)》/)?.[1]?.trim()
    if (quoted) return quoted

    const explicit = trimmed.match(/(?:都不对|不是这个|不要这些|换成|我要|改成|改为)(.+)$/)?.[1]?.trim()
    if (!explicit) return null
    const normalized = explicit.replace(/^[，,：:\s]+/, '').trim()
    return normalized || null
  }
}

let globalAtomicContinuationClassifier: AtomicContinuationClassifier | null = null

export function getAtomicContinuationClassifier(): AtomicContinuationClassifier {
  if (!globalAtomicContinuationClassifier) {
    globalAtomicContinuationClassifier = new AtomicContinuationClassifier()
  }
  return globalAtomicContinuationClassifier
}
