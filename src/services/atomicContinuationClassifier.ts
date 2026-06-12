import type { RuntimePendingAtomicContext } from '@/services/runtime/pendingAtomicContext'
import { parseAtomicOffset } from '@/services/atomicOffsetParser'
import { parseAtomicClockExpression } from '@/services/atomicTimeParser'
import { looksLikeProgramSchedulingRequest } from '@/services/schedulingIntentHeuristics'

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

    const correctionValue = input.pendingContext.phase === 'recommending_insert'
      ? this.resolveCorrectionValue(input.userInput)
      : null

    if (this.shouldInterruptAsFreshAtomicInstruction(input.pendingContext, normalized, input.userInput, correctionValue)) {
      return { kind: 'interrupt_as_new_task' }
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

  private shouldInterruptAsFreshAtomicInstruction(
    pendingContext: RuntimePendingAtomicContext,
    normalizedInput: string,
    rawUserInput: string,
    correctionValue?: string | null,
  ): boolean {
    const detectedAction = this.detectAtomicAction(normalizedInput)
    if (!detectedAction) return false

    const hasExactTime = Boolean(parseAtomicClockExpression(normalizedInput))
    const hasQuotedTitle = /《[^》]+》/.test(normalizedInput)
    const hasOffset = Boolean(parseAtomicOffset(normalizedInput))
    const hasProgramLikeText = this.hasProgramLikeText(rawUserInput, detectedAction)

    if (detectedAction !== pendingContext.action) {
      const isInsertCorrection =
        pendingContext.phase === 'recommending_insert'
        && pendingContext.action === 'insert'
        && detectedAction === 'replace'
        && Boolean(correctionValue)
        && !hasExactTime
        && !hasOffset
      if (isInsertCorrection) return false
      return hasExactTime || hasQuotedTitle || hasOffset || hasProgramLikeText
    }

    switch (detectedAction) {
      case 'move':
        return hasExactTime && hasOffset
      case 'delete':
        return hasExactTime || hasQuotedTitle
      case 'replace':
        return hasExactTime && /(替换成|替换为|换成|改成|改为).+/.test(normalizedInput)
      case 'insert':
        return hasExactTime && /(插入|插个|插一|加一条|加一档|加个|添加节目|添加|安排节目|安排|来个|来一条|来一档|放个|上个).+/.test(normalizedInput)
      default:
        return false
    }
  }

  private hasProgramLikeText(rawUserInput: string, detectedAction: RuntimePendingAtomicContext['action']): boolean {
    if (!detectedAction) return false

    const normalized = rawUserInput
      .trim()
      .replace(/《([^》]+)》/g, '$1')
      .replace(/(?:\d{1,2}[:：]\d{1,2}(?::\d{1,2})?|(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|點)(?:半|(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})分?)?)/g, '')
      .replace(/(?:提前|延后|顺延|前移|后移|往前挪|往后挪)?(?:\d{1,3}|[零〇一二两三四五六七八九十]{1,4}|半)(?:个)?(?:分钟|小时|分|秒)/g, '')
      .replace(/[，,。！？!?：:\s]/g, '')
      .replace(/^(?:把|将|在|于)/, '')

    const actionPatternByType: Record<NonNullable<RuntimePendingAtomicContext['action']>, RegExp> = {
      insert: /^(?:插入节目|插入|插个|插一|加一条|加一档|加个|添加节目|添加|安排节目|安排|来个|来一条|来一档|放个|上个)/,
      delete: /^(?:删除|删掉|移除|去掉|撤掉|拿掉)/,
      move: /^(?:后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前)/,
      replace: /^(?:替换成|替换为|替换|换成|换掉|改成|改为|改掉)/,
    }

    const stripped = normalized
      .replace(actionPatternByType[detectedAction], '')
      .replace(/^(?:成|为|到|向|往)/, '')

    if (!stripped) return false
    if (/^(?:这个|那个|这条|那条|这档|那档|节目|节目名|栏目|它)$/.test(stripped)) return false
    return stripped.length >= 2
  }

  private shouldInterruptAsNewTask(normalizedInput: string): boolean {
    if (looksLikeProgramSchedulingRequest(normalizedInput)) return true
    if (/(按这个版面开始编排|按该版面开始编排|确认版面|采用这个版面|用这个版面编排|就按这个版面|就按这个草案|按这个版面|按这个草案|照这个版面|照这个草案|这个版面可以|这个草案可以|可以开始编排|没问题开始编排)/.test(normalizedInput)) return true
    if (/(帮我全天编排|全天编排|整天编排|帮我填充全天节目|填充全天节目|补齐当前所有空窗|补齐当前空窗|补齐空窗|补齐当前所有空缺|补齐当前空缺)/.test(normalizedInput)) return true
    if (/(执行校验|请校验当前节目单|校验当前节目单|校验一下|看看有没有问题)/.test(normalizedInput)) return true
    if (/(版面|栏目|剧场|时段|上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/.test(normalizedInput)) return true
    return /(\d{1,2}(?::\d{2})?点?.*)(到|至|-).*(\d{1,2}(?::\d{2})?点?)/.test(normalizedInput)
      && /(新闻|栏目|剧场|电视剧|综艺|专题|资讯|纪录片|纪实|少儿|动画)/.test(normalizedInput)
  }

  private detectAtomicAction(normalizedInput: string): RuntimePendingAtomicContext['action'] {
    if (/(后移|前移|移动|顺一下|顺一个|挪一下|往后挪|往前挪|顺延|延后|提前)/.test(normalizedInput)) return 'move'
    if (/(删除|删掉|移除|去掉|撤掉|拿掉)/.test(normalizedInput)) return 'delete'
    if (/(替换|换成|替换成|替换为|换掉|改掉|改成|改为)/.test(normalizedInput)) return 'replace'
    if (/(插入|插个|插一|加一条|加一档|加个|添加节目|添加|安排节目|安排|来个|来一条|来一档|放个|上个)/.test(normalizedInput)) return 'insert'
    return null
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
