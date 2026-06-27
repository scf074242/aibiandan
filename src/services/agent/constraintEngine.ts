import type { ScheduleItemSnapshot } from '@/types/orchestration'
import type {
  AgentBroadcastReadinessEvidence,
  AgentConstraintIssue,
  AgentConstraintReport,
  AgentProgramCandidate,
  BatchDeleteCommandPlan,
  BatchMoveCommandPlan,
  DeleteCommandPlan,
  AgentValidationReport,
  InsertCommandPlan,
  MoveCommandPlan,
  ReplaceCommandPlan,
  SchedulingContext,
} from './types'
import { rangeOverlaps, toClockText } from './time'

export class AgentConstraintEngine {
  checkBatchDelete(command: BatchDeleteCommandPlan, context: SchedulingContext): AgentConstraintReport {
    const issues: AgentConstraintIssue[] = []
    const targets = command.itemIds
      .map((itemId) => context.scheduleItems.find((item) => item.id === itemId))
      .filter((item): item is ScheduleItemSnapshot => Boolean(item))

    if (targets.length !== command.itemIds.length) {
      issues.push({
        code: 'target_not_found',
        severity: 'critical',
        message: '部分待删除节目已经不存在，已停止批量删除。',
        detail: {
          requestedItemIds: command.itemIds,
          resolvedItemIds: targets.map((item) => item.id),
        },
      })
      return { ok: false, issues }
    }

    targets.forEach((target) => {
      if (context.lockedItemIds.includes(target.id)) {
        issues.push({
          code: 'locked_item',
          severity: 'critical',
          message: `节目《${target.programName}》已锁定，不能批量删除。`,
          detail: { itemId: target.id },
        })
      }
    })

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  checkBatchMove(command: BatchMoveCommandPlan, context: SchedulingContext, previewItems: ScheduleItemSnapshot[]): AgentConstraintReport {
    const issues: AgentConstraintIssue[] = []
    const targets = command.itemIds
      .map((itemId) => context.scheduleItems.find((item) => item.id === itemId))
      .filter((item): item is ScheduleItemSnapshot => Boolean(item))

    if (targets.length !== command.itemIds.length) {
      issues.push({
        code: 'target_not_found',
        severity: 'critical',
        message: '部分待移动节目已经不存在，已停止批量移动。',
        detail: {
          requestedItemIds: command.itemIds,
          resolvedItemIds: targets.map((item) => item.id),
        },
      })
      return { ok: false, issues }
    }

    targets.forEach((target) => {
      const moved = previewItems.find((item) => item.id === target.id)
      if (!moved) return

      if (context.lockedItemIds.includes(target.id)) {
        issues.push({
          code: 'locked_item',
          severity: 'critical',
          message: `节目《${target.programName}》已锁定，不能批量移动。`,
          detail: { itemId: target.id },
        })
      }

      if (context.layoutBounds && (
        new Date(moved.startTime).getTime() < new Date(context.layoutBounds.start).getTime()
        || new Date(moved.endTime).getTime() > new Date(context.layoutBounds.end).getTime()
      )) {
        issues.push({
          code: 'out_of_layout_bounds',
          severity: 'critical',
          message: `批量移动后《${target.programName}》时段 ${toClockText(moved.startTime)}-${toClockText(moved.endTime)} 超出版面边界。`,
          detail: {
            itemId: target.id,
            layoutBounds: context.layoutBounds,
          },
        })
      }

      const blockedRange = context.blockedTimeRanges.find((range) =>
        rangeOverlaps(moved.startTime, moved.endTime, range.start, range.end),
      )
      if (blockedRange) {
        issues.push({
          code: 'blocked_time_range',
          severity: 'critical',
          message: `批量移动后《${target.programName}》落入禁排范围 ${toClockText(blockedRange.start)}-${toClockText(blockedRange.end)}。`,
          detail: {
            itemId: target.id,
            blockedRange,
          },
        })
      }
    })

    const sorted = [...previewItems].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      if (!previous || !current) continue
      if (!rangeOverlaps(previous.startTime, previous.endTime, current.startTime, current.endTime)) continue
      issues.push({
        code: 'time_overlap',
        severity: 'critical',
        message: `批量移动后《${previous.programName}》与《${current.programName}》发生时间重叠。`,
        detail: {
          leftItemId: previous.id,
          rightItemId: current.id,
        },
      })
      break
    }

    const sequenceIssue = this.detectSequenceViolation(previewItems)
    if (sequenceIssue) {
      issues.push(sequenceIssue)
    }
    const historySequenceIssue = this.detectHistorySequenceViolation(context, previewItems)
    if (historySequenceIssue) {
      issues.push(historySequenceIssue)
    }

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  checkDelete(command: DeleteCommandPlan, context: SchedulingContext): AgentConstraintReport {
    const issues: AgentConstraintIssue[] = []
    const target = context.scheduleItems.find((item) => item.id === command.itemId)

    if (!target) {
      issues.push({
        code: 'target_not_found',
        severity: 'critical',
        message: `未找到要删除的节目 ${command.itemId}`,
      })
      return { ok: false, issues }
    }

    if (context.lockedItemIds.includes(command.itemId)) {
      issues.push({
        code: 'locked_item',
        severity: 'critical',
        message: `节目《${target.programName}》已锁定，不能删除。`,
        detail: { itemId: command.itemId },
      })
    }

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  checkInsert(command: InsertCommandPlan, context: SchedulingContext, previewItems: ScheduleItemSnapshot[]): AgentConstraintReport {
    const issues: AgentConstraintIssue[] = []
    const candidate = context.programCandidates.find((item) => item.id === command.candidateId)

    if (!candidate) {
      issues.push({
        code: 'program_not_found',
        severity: 'critical',
        message: `未找到要插入的节目候选 ${command.candidateId}`,
      })
      return { ok: false, issues }
    }

    const readiness = this.resolveCandidateReadiness(candidate, context)

    if (readiness.materialStatus && readiness.materialStatus !== 'ready') {
      issues.push({
        code: 'material_not_ready',
        severity: 'critical',
        message: `节目《${candidate.programName}》素材状态不可播。`,
        detail: { candidateId: candidate.id, materialStatus: readiness.materialStatus },
      })
    }

    if (readiness.rightsStatus && readiness.rightsStatus !== 'ready') {
      issues.push({
        code: 'rights_not_ready',
        severity: 'critical',
        message: `节目《${candidate.programName}》版权状态不可播。`,
        detail: { candidateId: candidate.id, rightsStatus: readiness.rightsStatus },
      })
    }

    if (context.layoutBounds && (
      new Date(command.insertTime).getTime() < new Date(context.layoutBounds.start).getTime()
      || new Date(command.endTime).getTime() > new Date(context.layoutBounds.end).getTime()
    )) {
      issues.push({
        code: 'out_of_layout_bounds',
        severity: 'critical',
        message: `插入时段 ${toClockText(command.insertTime)}-${toClockText(command.endTime)} 超出版面边界。`,
      })
    }

    const blockedRange = context.blockedTimeRanges.find((range) =>
      rangeOverlaps(command.insertTime, command.endTime, range.start, range.end),
    )
    if (blockedRange) {
      issues.push({
        code: 'blocked_time_range',
        severity: 'critical',
        message: `插入时段落入禁排范围 ${toClockText(blockedRange.start)}-${toClockText(blockedRange.end)}。`,
        detail: { blockedRange },
      })
    }

    const overlap = previewItems.find((item) =>
      item.id !== this.buildInsertedItemId(command)
      && rangeOverlaps(command.insertTime, command.endTime, item.startTime, item.endTime),
    )
    if (overlap) {
      issues.push({
        code: 'time_overlap',
        severity: 'critical',
        message: `插入后会与《${overlap.programName}》发生时间重叠。`,
        detail: {
          conflictItemId: overlap.id,
          conflictProgramName: overlap.programName,
          conflictRange: { start: overlap.startTime, end: overlap.endTime },
          proposedRange: { start: command.insertTime, end: command.endTime },
          blockedPolicy: 'no_auto_shift_replace_reorder',
        },
      })
    }

    const sequenceIssue = this.detectSequenceViolation(previewItems)
    if (sequenceIssue) {
      issues.push(sequenceIssue)
    }
    const historySequenceIssue = this.detectHistorySequenceViolation(context, previewItems)
    if (historySequenceIssue) {
      issues.push(historySequenceIssue)
    }

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  checkReplace(command: ReplaceCommandPlan, context: SchedulingContext, previewItems: ScheduleItemSnapshot[]): AgentConstraintReport {
    const issues: AgentConstraintIssue[] = []
    const target = context.scheduleItems.find((item) => item.id === command.itemId)
    const candidate = context.programCandidates.find((item) => item.id === command.candidateId)

    if (!target) {
      issues.push({
        code: 'target_not_found',
        severity: 'critical',
        message: `未找到要替换的节目 ${command.itemId}`,
      })
      return { ok: false, issues }
    }

    if (context.lockedItemIds.includes(command.itemId)) {
      issues.push({
        code: 'locked_item',
        severity: 'critical',
        message: `节目《${target.programName}》已锁定，不能替换。`,
        detail: { itemId: command.itemId },
      })
    }

    if (!candidate) {
      issues.push({
        code: 'program_not_found',
        severity: 'critical',
        message: `未找到要替换成的节目候选 ${command.candidateId}`,
      })
      return { ok: false, issues }
    }

    const readiness = this.resolveCandidateReadiness(candidate, context)

    if (readiness.materialStatus && readiness.materialStatus !== 'ready') {
      issues.push({
        code: 'material_not_ready',
        severity: 'critical',
        message: `节目《${candidate.programName}》素材状态不可播。`,
        detail: { candidateId: candidate.id, materialStatus: readiness.materialStatus },
      })
    }

    if (readiness.rightsStatus && readiness.rightsStatus !== 'ready') {
      issues.push({
        code: 'rights_not_ready',
        severity: 'critical',
        message: `节目《${candidate.programName}》版权状态不可播。`,
        detail: { candidateId: candidate.id, rightsStatus: readiness.rightsStatus },
      })
    }

    if (context.layoutBounds && (
      new Date(command.startTime).getTime() < new Date(context.layoutBounds.start).getTime()
      || new Date(command.endTime).getTime() > new Date(context.layoutBounds.end).getTime()
    )) {
      issues.push({
        code: 'out_of_layout_bounds',
        severity: 'critical',
        message: `替换后时段 ${toClockText(command.startTime)}-${toClockText(command.endTime)} 超出版面边界。`,
      })
    }

    const blockedRange = context.blockedTimeRanges.find((range) =>
      rangeOverlaps(command.startTime, command.endTime, range.start, range.end),
    )
    if (blockedRange) {
      issues.push({
        code: 'blocked_time_range',
        severity: 'critical',
        message: `替换后时段落入禁排范围 ${toClockText(blockedRange.start)}-${toClockText(blockedRange.end)}。`,
        detail: { blockedRange },
      })
    }

    const overlap = previewItems.find((item) =>
      item.id !== command.itemId
      && rangeOverlaps(command.startTime, command.endTime, item.startTime, item.endTime),
    )
    if (overlap) {
      issues.push({
        code: 'time_overlap',
        severity: 'critical',
        message: `替换后会与《${overlap.programName}》发生时间重叠。`,
        detail: {
          conflictItemId: overlap.id,
          conflictProgramName: overlap.programName,
          conflictRange: { start: overlap.startTime, end: overlap.endTime },
          proposedRange: { start: command.startTime, end: command.endTime },
          blockedPolicy: 'no_auto_shift_replace_reorder',
        },
      })
    }

    const sequenceIssue = this.detectSequenceViolation(previewItems)
    if (sequenceIssue) {
      issues.push(sequenceIssue)
    }
    const historySequenceIssue = this.detectHistorySequenceViolation(context, previewItems)
    if (historySequenceIssue) {
      issues.push(historySequenceIssue)
    }

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  checkMove(command: MoveCommandPlan, context: SchedulingContext, previewItems: ScheduleItemSnapshot[]): AgentConstraintReport {
    const issues: AgentConstraintIssue[] = []
    const target = context.scheduleItems.find((item) => item.id === command.itemId)

    if (!target) {
      issues.push({
        code: 'target_not_found',
        severity: 'critical',
        message: `未找到要移动的节目 ${command.itemId}`,
      })
      return { ok: false, issues }
    }

    if (context.lockedItemIds.includes(command.itemId)) {
      issues.push({
        code: 'locked_item',
        severity: 'critical',
        message: `节目《${target.programName}》已锁定，不能移动。`,
        detail: { itemId: command.itemId },
      })
    }

    if (context.layoutBounds && (
      new Date(command.newStartTime).getTime() < new Date(context.layoutBounds.start).getTime()
      || new Date(command.newEndTime).getTime() > new Date(context.layoutBounds.end).getTime()
    )) {
      issues.push({
        code: 'out_of_layout_bounds',
        severity: 'critical',
        message: `移动后时段 ${toClockText(command.newStartTime)}-${toClockText(command.newEndTime)} 超出版面边界。`,
        detail: {
          layoutBounds: context.layoutBounds,
          proposedRange: { start: command.newStartTime, end: command.newEndTime },
        },
      })
    }

    const blockedRange = context.blockedTimeRanges.find((range) =>
      rangeOverlaps(command.newStartTime, command.newEndTime, range.start, range.end),
    )
    if (blockedRange) {
      issues.push({
        code: 'blocked_time_range',
        severity: 'critical',
        message: `移动后时段落入禁排范围 ${toClockText(blockedRange.start)}-${toClockText(blockedRange.end)}。`,
        detail: { blockedRange },
      })
    }

    const overlap = previewItems.find((item) =>
      item.id !== command.itemId
      && rangeOverlaps(command.newStartTime, command.newEndTime, item.startTime, item.endTime),
    )
    if (overlap) {
      issues.push({
        code: 'time_overlap',
        severity: 'critical',
        message: `移动后会与《${overlap.programName}》发生时间重叠。`,
        detail: {
          conflictItemId: overlap.id,
          conflictProgramName: overlap.programName,
          conflictRange: { start: overlap.startTime, end: overlap.endTime },
          proposedRange: { start: command.newStartTime, end: command.newEndTime },
          blockedPolicy: 'no_auto_shift_replace_reorder',
        },
      })
    }

    const sequenceIssue = this.detectSequenceViolation(previewItems)
    if (sequenceIssue) {
      issues.push(sequenceIssue)
    }
    const historySequenceIssue = this.detectHistorySequenceViolation(context, previewItems)
    if (historySequenceIssue) {
      issues.push(historySequenceIssue)
    }

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  private buildInsertedItemId(command: InsertCommandPlan): string {
    return `agent_insert_${command.candidateId}_${command.insertTime}`
      .replace(/[^a-zA-Z0-9_]/g, '_')
  }

  validateSchedule(items: ScheduleItemSnapshot[]): AgentValidationReport {
    const issues: AgentConstraintIssue[] = []
    const sorted = [...items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      if (!previous || !current) continue
      if (!rangeOverlaps(previous.startTime, previous.endTime, current.startTime, current.endTime)) continue
      issues.push({
        code: 'time_overlap',
        severity: 'critical',
        message: `《${previous.programName}》与《${current.programName}》发生时间重叠。`,
        detail: {
          leftItemId: previous.id,
          rightItemId: current.id,
        },
      })
    }

    const sequenceIssue = this.detectSequenceViolation(sorted)
    if (sequenceIssue) issues.push(sequenceIssue)

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  validateContext(context: SchedulingContext): AgentValidationReport {
    const baseReport = this.validateSchedule(context.scheduleItems)
    const issues: AgentConstraintIssue[] = [...baseReport.issues]

    context.scheduleItems.forEach((item) => {
      if (context.layoutBounds && (
        new Date(item.startTime).getTime() < new Date(context.layoutBounds.start).getTime()
        || new Date(item.endTime).getTime() > new Date(context.layoutBounds.end).getTime()
      )) {
        issues.push({
          code: 'out_of_layout_bounds',
          severity: 'critical',
          message: `《${item.programName}》时段 ${toClockText(item.startTime)}-${toClockText(item.endTime)} 超出版面边界。`,
          detail: {
            itemId: item.id,
            layoutBounds: context.layoutBounds,
          },
        })
      }

      const blockedRange = context.blockedTimeRanges.find((range) =>
        rangeOverlaps(item.startTime, item.endTime, range.start, range.end),
      )
      if (blockedRange) {
        issues.push({
          code: 'blocked_time_range',
          severity: 'critical',
          message: `《${item.programName}》落入禁排范围 ${toClockText(blockedRange.start)}-${toClockText(blockedRange.end)}。`,
          detail: {
            itemId: item.id,
            blockedRange,
          },
        })
      }
    })

    return {
      ok: issues.every((issue) => issue.severity !== 'critical'),
      issues,
    }
  }

  private detectSequenceViolation(items: ScheduleItemSnapshot[]): AgentConstraintIssue | null {
    const sorted = [...items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    const previousBySeries = new Map<string, ScheduleItemSnapshot>()

    for (const item of sorted) {
      const seriesKey = this.buildSeriesKey(item)
      const sequenceNo = this.extractSequenceNo(item)
      if (!seriesKey || sequenceNo === null) continue

      const previous = previousBySeries.get(seriesKey)
      if (previous) {
        const previousSequenceNo = this.extractSequenceNo(previous)
        if (previousSequenceNo !== null && sequenceNo < previousSequenceNo) {
          return {
            code: 'sequence_violation',
            severity: 'critical',
            message: `《${item.programName}》会造成连续剧顺播倒序。`,
            detail: {
              previousItemId: previous.id,
              currentItemId: item.id,
              previousSequenceNo,
              currentSequenceNo: sequenceNo,
            },
          }
        }
        if (previousSequenceNo !== null && sequenceNo > previousSequenceNo + 1) {
          return {
            code: 'sequence_violation',
            severity: 'critical',
            message: `《${item.programName}》会造成连续剧顺播跳集。`,
            detail: {
              previousItemId: previous.id,
              currentItemId: item.id,
              previousSequenceNo,
              currentSequenceNo: sequenceNo,
            },
          }
        }
      }

      previousBySeries.set(seriesKey, item)
    }

    return null
  }

  private detectHistorySequenceViolation(context: SchedulingContext, items: ScheduleItemSnapshot[]): AgentConstraintIssue | null {
    if (context.playlistType !== 'tv') return null
    const historyItems = context.bundle.history.latestSchedule?.items ?? []
    if (historyItems.length === 0) return null

    const existingTodaySeriesKeys = new Set<string>()
    context.scheduleItems.forEach((item) => {
      this.buildSeriesKeys(item).forEach((seriesKey) => existingTodaySeriesKeys.add(seriesKey))
    })

    const firstTodayBySeries = new Map<string, ScheduleItemSnapshot>()
    const sortedToday = [...items].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    sortedToday.forEach((item) => {
      this.buildSeriesKeys(item).forEach((seriesKey) => {
        if (!firstTodayBySeries.has(seriesKey)) firstTodayBySeries.set(seriesKey, item)
      })
    })

    const lastHistoryBySeries = new Map<string, ScheduleItemSnapshot>()
    const sortedHistory = [...historyItems].sort(
      (left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime(),
    )
    sortedHistory.forEach((item) => {
      this.buildSeriesKeys(item).forEach((seriesKey) => {
        lastHistoryBySeries.set(seriesKey, item)
      })
    })

    for (const [seriesKey, firstToday] of firstTodayBySeries.entries()) {
      if (existingTodaySeriesKeys.has(seriesKey)) continue
      const historyItem = lastHistoryBySeries.get(seriesKey)
      if (!historyItem) continue
      const historySequenceNo = this.extractSequenceNo(historyItem)
      const firstTodaySequenceNo = this.extractSequenceNo(firstToday)
      if (historySequenceNo === null || firstTodaySequenceNo === null) continue
      const expectedSequenceNo = historySequenceNo + 1
      if (firstTodaySequenceNo !== expectedSequenceNo) {
        return {
          code: 'sequence_violation',
          severity: 'critical',
          message: `TV playlist sequence must continue from history: expected episode ${expectedSequenceNo}, got episode ${firstTodaySequenceNo}.`,
          detail: {
            source: 'history',
            historyDate: context.bundle.history.latestSchedule?.date,
            historyItemId: historyItem.id,
            firstTodayItemId: firstToday.id,
            seriesKey,
            expectedSequenceNo,
            historySequenceNo,
            firstTodaySequenceNo,
          },
        }
      }
    }

    return null
  }

  private buildSeriesKey(item: ScheduleItemSnapshot): string {
    return this.buildSeriesKeys(item)[0] ?? ''
  }

  private buildSeriesKeys(item: ScheduleItemSnapshot): string[] {
    const keys: string[] = []
    const name = item.programName
      .trim()
      .toLowerCase()
      .replace(/^[^:：]+[:：]/u, '')
      .replace(/第\s*[0-9零〇一二两三四五六七八九十百]+\s*[集期]/gu, '')
      .replace(/[《》“”"'（）()【】、。；;：:\-—\s]/g, '')
    if (name) keys.push(`name:${name}`)
    if (item.programCode) keys.push(`code:${item.programCode.replace(/\d{1,4}$/, '')}`)
    return Array.from(new Set(keys))
  }

  private extractSequenceNo(item: ScheduleItemSnapshot): number | null {
    const issueNo = Number((item as ScheduleItemSnapshot & { issueNo?: string }).issueNo)
    if (Number.isFinite(issueNo) && issueNo > 0) return issueNo

    const codeMatch = item.programCode.match(/(\d{1,4})$/)
    if (codeMatch) {
      const parsed = Number(codeMatch[1])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }

    const nameMatch = item.programName.match(/第\s*([0-9零〇一二两三四五六七八九十百]+)\s*[集期]/u)
    return nameMatch ? this.parseChineseNumber(nameMatch[1]!) : null
  }

  private parseChineseNumber(value: string): number | null {
    const direct = Number(value)
    if (Number.isFinite(direct) && direct > 0) return direct
    const digits: Record<string, number> = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    }
    if (value === '十') return 10
    const tenIndex = value.indexOf('十')
    if (tenIndex >= 0) {
      const high = tenIndex === 0 ? 1 : digits[value[tenIndex - 1]!] ?? 0
      const low = digits[value[tenIndex + 1]!] ?? 0
      return high * 10 + low
    }
    return value.split('').reduce((sum, char) => sum * 10 + (digits[char] ?? 0), 0) || null
  }

  private resolveCandidateReadiness(
    candidate: AgentProgramCandidate,
    context: SchedulingContext,
  ): AgentBroadcastReadinessEvidence {
    const explicit = context.broadcastReadiness.find((record) =>
      (record.candidateId && record.candidateId === candidate.id)
      || (record.programId && record.programId === candidate.programId)
      || (record.programCode && record.programCode === candidate.programCode),
    )
    return {
      candidateId: candidate.id,
      programId: candidate.programId,
      programCode: candidate.programCode,
      materialStatus: explicit?.materialStatus ?? candidate.materialStatus,
      rightsStatus: explicit?.rightsStatus ?? candidate.rightsStatus,
      updatedAt: explicit?.updatedAt,
      source: explicit?.source,
    }
  }
}
