import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import { getCandidateService, resetCandidateService } from '@/services/candidateService'
import { resetDataService } from '@/services/orchestration/dataService'
import { OpenClawBridge } from '@/services/openclaw/openClawBridge'
import { Orchestrator } from '@/services/orchestrator'
import { LayoutImportService } from '@/services/layoutImportService'
import type { LLMClient } from '@/services/llm/llmClient'
import type { TaskClassifier } from '@/services/llm/taskClassifier'
import type { GapInfo, ScheduleItemSnapshot } from '@/types/orchestration'

const date = '2026-03-25'
const iso = (time: string) => `${date}T${time}+08:00`
const uploadFixturePath = resolve(process.cwd(), 'test-fixtures/browser/smg-weekday-layout.xlsx')

const createOrchestrator = () => new Orchestrator(
  {
    chat: vi.fn(async () => {
      throw new Error('LLM unavailable in bridge-to-orchestrator test')
    }),
  } as unknown as LLMClient,
  {} as unknown as TaskClassifier,
  {
    planningLlmTimeoutMs: 20,
  },
)

const createScheduledItem = (overrides: Partial<ScheduleItemSnapshot>): ScheduleItemSnapshot => ({
  id: 'scheduled-item',
  programCode: 'existing-program',
  programName: '已有节目',
  startTime: iso('06:00:00'),
  endTime: iso('07:00:00'),
  duration: 3600,
  programType: 'news',
  ...overrides,
})

const importUploadedLayout = async () => {
  const service = new LayoutImportService()
  const file = new File([readFileSync(uploadFixturePath)], 'smg-weekday-layout.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const imported = await service.importFile(file, 'dragon', date)
  setRuntimeLayout(imported)
  return imported
}

const prepareAndCommitNaturalLanguageDraft = async (input: {
  conversationId: string
  text: string
  expectedCoverage: { start: string; end: string }
  expectedProgramType: string
}) => {
  const bridge = new OpenClawBridge()

  const prepare = await bridge.submitInstruction({
    conversationId: input.conversationId,
    channelId: 'dragon',
    channelName: '东方卫视',
    date,
    text: input.text,
    currentSchedule: [],
    gapCount: 1,
    history: [],
  })

  expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
  expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual(input.expectedCoverage)
  expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.defaultProgramType).toBe(input.expectedProgramType)

  const commit = await bridge.submitInstruction({
    conversationId: input.conversationId,
    channelId: 'dragon',
    channelName: '东方卫视',
    date,
    text: '确认版面',
    currentSchedule: [],
    gapCount: 1,
    history: [],
  })

  expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
  const request = bridge.getSessionState(commit.sessionId)?.lastDecision
  expect(request?.kind).toBe('layout_commit')
  if (!request || request.kind !== 'layout_commit') {
    throw new Error('expected layout_commit decision')
  }

  setRuntimeLayout({
    sourceFileName: `AI draft ${input.conversationId}`,
    channelId: request.draft.channelId,
    date: request.draft.date,
    warnings: request.draft.warnings ?? [],
    layoutReference: request.draft.layoutReference,
    columns: request.draft.columns,
  })
}

const expectNoOverlap = (items: ScheduleItemSnapshot[]) => {
  expect(items.every((item, index) => {
    const next = items[index + 1]
    return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
  })).toBe(true)
}

describe('OpenClawBridge to Orchestrator TV sequence flow', () => {
  beforeEach(async () => {
    clearRuntimeLayout('dragon', date)
    resetCandidateService()
    resetDataService()
    await resetAtomicCapabilities()
  })

  afterEach(async () => {
    clearRuntimeLayout('dragon', date)
    resetCandidateService()
    resetDataService()
    await resetAtomicCapabilities()
  })

  it('确认纯电视频道草案后正式编排会参考昨日进度写入下一集', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-tv-sequence',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '按纯电视频道，9:30到10:15继续播品质剧场：纵有疾风起，接昨天进度顺播',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('tv_channel')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.requiresPreviousSchedule).toBe(true)

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-tv-sequence',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI 版面草案',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '06:00:00', '23:59:59', {
      target: 'bridge-tv-sequence-e2e',
      allowFiller: false,
      sequentialPreference: true,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.some((item) => item.programCode === '881120030005')).toBe(true)
    expect(items.find((item) => item.programCode === '881120030005')?.programName).toBeTruthy()
    expect(items.some((item) => item.programCode === '881120030004')).toBe(false)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  }, 10000)

  it('当前版面已有同剧集上下文时会覆盖昨日进度并补中间集', async () => {
    const bridge = new OpenClawBridge()
    const existingItems = [
      createScheduledItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 1,
      }),
      createScheduledItem({
        id: 'existing-1030-episode-3',
        programCode: '002601120003',
        programName: '品质剧场：纵有疾风起 第3集',
        startTime: iso('10:30:00'),
        endTime: iso('11:15:00'),
        duration: 2700,
        programType: 'drama',
        sequence: 2,
      }),
    ]
    const currentSchedule = existingItems.map((item) => ({
      id: item.id,
      programCode: item.programCode,
      programName: item.programName,
      startTime: item.startTime.slice(11, 19),
      endTime: item.endTime.slice(11, 19),
      duration: item.duration,
      programType: item.programType,
    }))

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-current-schedule-overrides-history',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '按纯电视频道，09:45到10:30继续播品质剧场：纵有疾风起，顺着当前版面补中间集',
      currentSchedule,
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '09:45:00',
      end: '10:30:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('tv_channel')
    expect(prepare.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(0)

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-current-schedule-overrides-history',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule,
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI current schedule overrides history draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })
    await getAtomicCapabilities().replaceAllItems(existingItems, { skipValidation: true })
    resetCandidateService()
    const orchestrator = createOrchestrator()
    const logs: Array<{ phase?: string; details?: unknown }> = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '09:00:00', '11:15:00', {
      target: 'bridge-current-schedule-overrides-history-e2e',
      allowFiller: false,
      sequentialPreference: true,
    })

    const items = getAtomicCapabilities().getAllItems()
    const middleEpisodeSegments = items.filter((item) => item.programCode === '002601120002')
    expect(middleEpisodeSegments.length).toBeGreaterThan(0)
    expect(middleEpisodeSegments.every((item) => item.programName.includes('第2集'))).toBe(true)
    expect(middleEpisodeSegments[0]?.startTime).toBe(iso('09:45:00'))
    expect(middleEpisodeSegments.at(-1)?.endTime).toBe(iso('10:30:00'))
    expect(items.some((item) => item.programCode === '881120030005')).toBe(false)
    const uniqueProgramCodes = items
      .filter((item) => item.programType !== 'ad')
      .map((item) => item.programCode)
      .filter((code, index, codes) => index === 0 || code !== codes[index - 1])
    expect(uniqueProgramCodes).toEqual([
      '002601120001',
      '002601120002',
      '002601120003',
    ])
    expect(logs.some((entry) => {
      const diagnostics = (entry.details as { diagnostics?: { notes?: string[] } } | undefined)?.diagnostics
      return entry.phase === 'query' && diagnostics?.notes?.includes('current_schedule_overrides_history')
    })).toBe(true)
    expectNoOverlap(items)
  }, 20_000)

  it('确认草案时会用最新节目单上下文阻止早段倒序回填', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-confirm-rechecks-sequence-context',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '按纯电视频道，08:00到08:45继续播品质剧场：纵有疾风起，顺着排',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('tv_channel')
    expect(prepare.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(0)

    const existingEpisode = createScheduledItem({
      id: 'existing-0900-episode-1',
      programCode: '881120030001',
      programName: '品质剧场：纵有疾风起 第1集',
      startTime: iso('09:00:00'),
      endTime: iso('09:45:00'),
      duration: 2700,
      programType: 'drama',
      sequence: 1,
    })
    await getAtomicCapabilities().replaceAllItems([existingEpisode], { skipValidation: true })

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-confirm-rechecks-sequence-context',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [existingEpisode],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_draft')
    expect(commit.payload?.layoutDraftFeasibility?.segments[0]?.blockerKind).toBe('schedule_context')
    expect(commit.summary).toContain('不会进入正式编排')
    expect(bridge.getSessionState(commit.sessionId)?.lastDecision?.kind).not.toBe('layout_commit')
    expect(getAtomicCapabilities().getAllItems()).toEqual([existingEpisode])
  })

  it('确认局部补排草案后正式编排会保留已有上午节目并只填充下午空窗', async () => {
    const bridge = new OpenClawBridge()
    const existingMorningItems = [
      createScheduledItem({
        id: 'existing-0600-news',
        programCode: 'existing-news-0600',
        programName: '东方快报',
        startTime: iso('06:00:00'),
        endTime: iso('07:00:00'),
        duration: 3600,
        programType: 'news',
      }),
      createScheduledItem({
        id: 'existing-0900-magazine',
        programCode: 'existing-magazine-0900',
        programName: '看东方',
        startTime: iso('09:00:00'),
        endTime: iso('10:00:00'),
        duration: 3600,
        programType: 'news_magazine',
      }),
    ]

    await getAtomicCapabilities().replaceAllItems(existingMorningItems, { skipValidation: true })

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-partial-fill',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '保留现有上午节目，下午补齐电视剧',
      currentSchedule: existingMorningItems.map((item) => ({
        id: item.id,
        programName: item.programName,
        startTime: item.startTime.slice(11, 19),
        endTime: item.endTime.slice(11, 19),
        duration: item.duration,
        programType: item.programType,
      })),
      gapCount: 1,
      history: ['用户：上午新闻', '助手：已完成上午新闻编排。'],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.layoutDraftMode).toBe('partial_generate')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '13:00:00',
      end: '18:00:00',
    })

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-partial-fill',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: existingMorningItems.map((item) => ({
        id: item.id,
        programName: item.programName,
        startTime: item.startTime.slice(11, 19),
        endTime: item.endTime.slice(11, 19),
        duration: item.duration,
        programType: item.programType,
      })),
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI 版面草案',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startPartialGeneration('dragon', date)

    const items = getAtomicCapabilities().getAllItems()
    expect(items.find((item) => item.id === 'existing-0600-news')).toMatchObject({
      programName: '东方快报',
      startTime: iso('06:00:00'),
      endTime: iso('07:00:00'),
    })
    expect(items.find((item) => item.id === 'existing-0900-magazine')).toMatchObject({
      programName: '看东方',
      startTime: iso('09:00:00'),
      endTime: iso('10:00:00'),
    })

    const afternoonDramaItems = items.filter((item) => (
      item.programType === 'drama'
      && new Date(item.startTime).getTime() >= new Date(iso('13:00:00')).getTime()
      && new Date(item.endTime).getTime() <= new Date(iso('18:00:00')).getTime()
    ))
    expect(afternoonDramaItems.length).toBeGreaterThan(0)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  }, 15_000)

  it('上传版面确认后正式编排会按 xlsx 版面时段和类型生成节目', async () => {
    const imported = await importUploadedLayout()
    expect(imported.templateMode).toBe('weekday_sheet')
    expect(imported.layoutReference.slots).toHaveLength(9)

    const bridge = new OpenClawBridge()
    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-uploaded-layout',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '按这个版面开始编排',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }
    expect(request.draft.source).toBe('uploaded')
    expect(request.draft.columns[0]?.columnName).toBe('Morning News')
    expect(request.draft.columns[0]?.queryHints ?? []).not.toContain('Morning News')

    setRuntimeLayout({
      sourceFileName: '上传版面草案',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '06:00:00', '23:59:59', {
      target: 'uploaded-layout-e2e',
      allowFiller: false,
      sequentialPreference: true,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.length).toBeGreaterThan(0)
    expect(items.some((item) => item.programType === 'news')).toBe(true)
    expect(items.some((item) => item.programType === 'news_magazine')).toBe(true)
    expect(items.some((item) => item.programType === 'drama')).toBe(true)
    expect(items.some((item) => item.programType === 'health')).toBe(true)
    expect(items.some((item) => item.programType === 'documentary')).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)

    const morningNewsItem = items.find((item) => (
      item.programType === 'news'
      && new Date(item.startTime).getTime() >= new Date(iso('06:00:00')).getTime()
      && new Date(item.endTime).getTime() <= new Date(iso('07:00:00')).getTime()
    ))
    const documentaryItem = items.find((item) => (
      item.programType === 'documentary'
      && new Date(item.startTime).getTime() >= new Date(iso('22:00:00')).getTime()
      && new Date(item.endTime).getTime() <= new Date(iso('23:00:00')).getTime()
    ))
    expect(morningNewsItem).toBeTruthy()
    expect(documentaryItem).toBeTruthy()
  }, 20_000)

  it('基于黄金档段落的自然语言草案确认后会正式编排综艺节目', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-golden-entertainment',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '黄金档主打综艺',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '19:00:00',
      end: '20:00:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.defaultProgramType).toBe('entertainment')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-golden-entertainment',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI golden entertainment draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '19:00:00', '20:00:00', {
      target: 'golden-entertainment-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.some((item) => item.programType === 'entertainment')).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  }, 20_000)

  it('基于事件前导视的自然语言草案确认后会正式编排导视节目', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-event-guide',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '发布会开播前垫一点现场导视',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '18:00:00',
      end: '23:00:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.semanticLabel).toContain('现场导视')
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.defaultProgramType).toBe('news_magazine')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-event-guide',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI event guide draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '18:00:00', '23:00:00', {
      target: 'event-guide-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.some((item) => item.programName.includes('导视'))).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  }, 20_000)

  it('连续时长多段草案确认后会按段落边界正式编排导视和直播节目', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-multi-segment-guide-live',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14点先来10分钟导视，再50分钟静安寺直播',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.layoutReference.slots.map((slot) => (
      `${slot.startTime.slice(11, 19)}-${slot.endTime.slice(11, 19)}`
    ))).toEqual([
      '14:00:00-14:10:00',
      '14:10:00-15:00:00',
    ])
    expect(prepare.payload?.pendingLayoutDraft?.columns.map((column) => column.selectionPolicy?.primary)).toEqual([
      'content_match',
      'content_match',
    ])

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-multi-segment-guide-live',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI multi segment guide live draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'multi-segment-guide-live-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const programItems = items.filter((item) => item.programType !== 'ad')
    expect(programItems.length).toBeGreaterThanOrEqual(2)
    expect(programItems[0]?.startTime).toBe(iso('14:00:00'))
    expect(programItems[0]?.endTime).toBe(iso('14:10:00'))
    expect(programItems[0]?.programName).toContain('导视')
    const liveSegmentItems = programItems.filter((item) =>
      item.startTime >= iso('14:10:00') && item.endTime <= iso('15:00:00'),
    )
    expect(liveSegmentItems[0]?.startTime).toBe(iso('14:10:00'))
    expect(liveSegmentItems.at(-1)?.endTime).toBe(iso('15:00:00'))
    expect(liveSegmentItems.some((item) => `${item.programName} ${item.programCode}`.match(/静安寺|直播/))).toBe(true)
    expect(liveSegmentItems.every((item) => `${item.programName} ${item.programCode}`.match(/静安寺|直播/))).toBe(true)
    expectNoOverlap(items)
  }, 20_000)

  it('明确片名在节目库无匹配时确认草案不会硬排相似电视剧', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-unmatched-title',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14:00到15:00安排生命树电视剧',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(prepare.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(1)
    expect(prepare.payload?.layoutDraftFeasibility?.segments[0]?.blockerKind).toBe('keyword')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-to-orchestrator-unmatched-title',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_draft')
    expect(commit.summary).toContain('不会进入正式编排')
    expect(bridge.getSessionState(commit.sessionId)?.lastDecision?.kind).not.toBe('layout_commit')

    const items = getAtomicCapabilities().getAllItems()
    expect(items).toHaveLength(0)
  }, 20_000)

  it('明确节目标题和集数会作为硬约束贯穿到正式编排', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-explicit-title-episode-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '09:30到10:15安排节目标题纵有疾风起第5集',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '09:30:00',
      end: '10:15:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.queryHints?.join(' ')).toMatch(/纵有疾风起.*第5集/)
    expect(prepare.payload?.layoutDraftFeasibility?.summary.blockedCount).toBe(0)

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-explicit-title-episode-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI explicit title episode draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '09:30:00', '10:15:00', {
      target: 'explicit-title-episode-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.some((item) => item.programCode === '881120030005')).toBe(true)
    expect(items.some((item) => item.programCode === '881120030004')).toBe(false)
    expect(items.some((item) => item.programCode === '881120030006')).toBe(false)
    expect(items.find((item) => item.programCode === '881120030005')?.programName).toContain('第5集')
    expectNoOverlap(items)
  }, 20_000)

  it('所属栏目和节目内容组合关键词会贯穿草案检索选择到正式编排', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-column-content-keywords-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14:00到15:00安排所属栏目看东方、节目内容静安寺的轮播单，内容匹配优先',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.selectionPriority).toBe('content_match')
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.queryHints).toEqual(
      expect.arrayContaining(['所属栏目看东方', '节目内容静安寺']),
    )

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-column-content-keywords-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI column content keyword draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'column-content-keywords-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const programItems = getAtomicCapabilities().getAllItems().filter((item) => item.programType !== 'ad')
    expect(programItems.length).toBeGreaterThan(0)
    const candidates = programItems.map((item) => getCandidateService().getCandidateById(item.programCode ?? item.id))
    expect(candidates.every((candidate) => candidate?.columnName === '看东方')).toBe(true)
    expect(candidates.every((candidate) => candidate?.contentTags?.includes('静安寺'))).toBe(true)
    expectNoOverlap(getAtomicCapabilities().getAllItems())
  }, 20_000)

  it('轮播单收视率优先草案确认后会按收视策略正式编排且不读取昨日顺播', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-carousel-rating-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14:00到15:00做一版电视剧轮播单，优先选择高收视率节目',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('carousel')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.selectionPriority).toBe('rating')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.requiresPreviousSchedule).toBe(false)
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.selectionPolicy?.primary).toBe('rating')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-carousel-rating-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI carousel rating draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))
    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'carousel-rating-natural-language-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const programItems = items.filter((item) => item.programType !== 'ad')
    const firstQueryLog = logs.find((entry) => {
      const details = entry.details as { diagnostics?: { selectionPriority?: string }; topCandidates?: Array<{ programCode?: string }> } | undefined
      return entry.phase === 'query'
        && details?.diagnostics?.selectionPriority === 'rating'
        && Array.isArray(details.topCandidates)
        && details.topCandidates.length > 0
    })
    const expectedTopCandidate = (firstQueryLog?.details as { topCandidates?: Array<{ programCode?: string; estimatedRating?: number }> } | undefined)?.topCandidates?.[0]
    expect(firstQueryLog).toBeTruthy()
    expect((firstQueryLog?.details as { diagnostics?: { notes?: string[] } } | undefined)?.diagnostics?.notes).not.toContain('history_reference_loaded')
    expect(expectedTopCandidate?.estimatedRating).toEqual(
      expect.any(Number),
    )
    expect(programItems.some((item) => item.programCode === expectedTopCandidate!.programCode)).toBe(true)
    expect(programItems.some((item) => item.programCode === '881120030005')).toBe(false)
    expectNoOverlap(items)
  }, 20_000)

  it('轮播单热播优先草案确认后会按话题热度策略正式编排', async () => {
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-carousel-trending-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14:00到15:00做一版电视剧轮播单，优先选择当前热播节目',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.kind).toBe('carousel')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.selectionPriority).toBe('trending')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.requiresPreviousSchedule).toBe(false)
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.selectionPolicy?.primary).toBe('trending')
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.selectionRules.join('\n')).toContain('话题热度')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-carousel-trending-to-schedule',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule: [],
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI carousel trending draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))
    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'carousel-trending-natural-language-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const programItems = items.filter((item) => item.programType !== 'ad')
    const firstQueryLog = logs.find((entry) => {
      const details = entry.details as { diagnostics?: { selectionPriority?: string }; topCandidates?: Array<{ programCode?: string }> } | undefined
      return entry.phase === 'query'
        && details?.diagnostics?.selectionPriority === 'trending'
        && Array.isArray(details.topCandidates)
        && details.topCandidates.length > 0
    })
    const expectedTopCandidate = (firstQueryLog?.details as { topCandidates?: Array<{ programCode?: string; popularityScore?: number; editorialDecision?: { strategy?: string } }> } | undefined)?.topCandidates?.[0]
    expect(firstQueryLog).toBeTruthy()
    expect((firstQueryLog?.details as { diagnostics?: { notes?: string[] } } | undefined)?.diagnostics?.notes).not.toContain('history_reference_loaded')
    expect(expectedTopCandidate?.popularityScore).toEqual(expect.any(Number))
    expect(programItems.some((item) => item.programCode === expectedTopCandidate!.programCode)).toBe(true)
    expectNoOverlap(items)
  }, 20_000)

  it('正式编排会保留目标时段内已有节目并只填剩余空窗', async () => {
    const existingItem = createScheduledItem({
      id: 'existing-1400-special',
      programCode: 'existing-1400-special-code',
      programName: '已有专题节目',
      startTime: iso('14:00:00'),
      endTime: iso('14:30:00'),
      duration: 1800,
      programType: 'news_magazine',
    })
    await getAtomicCapabilities().replaceAllItems([existingItem], { skipValidation: true })

    const currentSchedule = [{
      id: existingItem.id,
      programCode: existingItem.programCode,
      programName: existingItem.programName,
      startTime: existingItem.startTime.slice(11, 19),
      endTime: existingItem.endTime.slice(11, 19),
      duration: existingItem.duration,
      programType: existingItem.programType,
    }]
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-preserve-existing-in-target-range',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14:00到15:00安排静安寺外场直播轮播单，内容匹配优先',
      currentSchedule,
      gapCount: 1,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.strategyProfile?.selectionPriority).toBe('content_match')

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-preserve-existing-in-target-range',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule,
      gapCount: 1,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI preserve existing target draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'preserve-existing-target-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.find((item) => item.id === existingItem.id)).toMatchObject({
      programName: '已有专题节目',
      startTime: iso('14:00:00'),
      endTime: iso('14:30:00'),
    })
    const filledItems = items.filter((item) =>
      item.id !== existingItem.id
      && item.programType !== 'ad'
      && item.startTime >= iso('14:30:00')
      && item.endTime <= iso('15:00:00'),
    )
    expect(filledItems.length).toBeGreaterThan(0)
    expect(filledItems.some((item) => `${item.programName} ${item.programCode}`.match(/静安寺|直播/))).toBe(true)
    expect(items.every((item) => item.id === existingItem.id || item.startTime >= iso('14:30:00') || item.endTime <= iso('14:00:00'))).toBe(true)
    expectNoOverlap(items)
  }, 20_000)

  it('目标时段中间已有节目时会按结构化关键词只填前后剩余空窗', async () => {
    const existingItem = createScheduledItem({
      id: 'existing-1420-special',
      programCode: 'existing-1420-special-code',
      programName: '已有专题节目',
      startTime: iso('14:20:00'),
      endTime: iso('14:40:00'),
      duration: 1200,
      programType: 'news_magazine',
    })
    await getAtomicCapabilities().replaceAllItems([existingItem], { skipValidation: true })

    const currentSchedule = [{
      id: existingItem.id,
      programCode: existingItem.programCode,
      programName: existingItem.programName,
      startTime: existingItem.startTime.slice(11, 19),
      endTime: existingItem.endTime.slice(11, 19),
      duration: existingItem.duration,
      programType: existingItem.programType,
    }]
    const bridge = new OpenClawBridge()

    const prepare = await bridge.submitInstruction({
      conversationId: 'conv-bridge-preserve-middle-existing-with-field-keywords',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '14:00到15:00安排所属栏目看东方、节目内容静安寺的轮播单，内容匹配优先，保留已有节目',
      currentSchedule,
      gapCount: 2,
      history: [],
    })

    expect(prepare.payload?.lastDecisionKind).toBe('layout_draft')
    expect(prepare.payload?.pendingLayoutDraft?.coverage).toEqual({
      start: '14:00:00',
      end: '15:00:00',
    })
    expect(prepare.payload?.pendingLayoutDraft?.columns[0]?.queryHints).toEqual(
      expect.arrayContaining(['所属栏目看东方', '节目内容静安寺']),
    )

    const commit = await bridge.submitInstruction({
      conversationId: 'conv-bridge-preserve-middle-existing-with-field-keywords',
      channelId: 'dragon',
      channelName: '东方卫视',
      date,
      text: '确认版面',
      currentSchedule,
      gapCount: 2,
      history: [],
    })

    expect(commit.payload?.lastDecisionKind).toBe('layout_commit')
    const request = bridge.getSessionState(commit.sessionId)?.lastDecision
    expect(request?.kind).toBe('layout_commit')
    if (!request || request.kind !== 'layout_commit') {
      throw new Error('expected layout_commit decision')
    }

    setRuntimeLayout({
      sourceFileName: 'AI preserve middle existing field keyword draft',
      channelId: request.draft.channelId,
      date: request.draft.date,
      warnings: request.draft.warnings ?? [],
      layoutReference: request.draft.layoutReference,
      columns: request.draft.columns,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'preserve-middle-existing-field-keywords-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.find((item) => item.id === existingItem.id)).toMatchObject({
      programName: '已有专题节目',
      startTime: iso('14:20:00'),
      endTime: iso('14:40:00'),
    })

    const filledItems = items.filter((item) =>
      item.id !== existingItem.id
      && item.programType !== 'ad'
      && item.startTime >= iso('14:00:00')
      && item.endTime <= iso('15:00:00'),
    )
    expect(filledItems.length).toBeGreaterThan(0)
    expect(filledItems.every((item) =>
      item.endTime <= iso('14:20:00') || item.startTime >= iso('14:40:00'),
    )).toBe(true)

    const candidates = filledItems.map((item) => getCandidateService().getCandidateById(item.programCode ?? item.id))
    expect(candidates.every((candidate) => candidate?.columnName === '看东方')).toBe(true)
    expect(candidates.every((candidate) => candidate?.contentTags?.includes('静安寺'))).toBe(true)
    expect(items.every((item) =>
      item.id === existingItem.id
      || item.endTime <= iso('14:20:00')
      || item.startTime >= iso('14:40:00'),
    )).toBe(true)
    expectNoOverlap(items)
  }, 20_000)

  it.each([
    {
      id: 'news-noon',
      text: '12:00到12:30安排午间新闻',
      coverage: { start: '12:00:00', end: '12:30:00' },
      programType: 'news',
    },
    {
      id: 'news-magazine-afternoon',
      text: '15:00到16:00安排资讯专题节目',
      coverage: { start: '15:00:00', end: '16:00:00' },
      programType: 'news_magazine',
    },
    {
      id: 'entertainment-evening',
      text: '20:00到21:00安排综艺娱乐节目',
      coverage: { start: '20:00:00', end: '21:00:00' },
      programType: 'entertainment',
    },
    {
      id: 'health-afternoon',
      text: '13:00到14:00安排健康养生节目',
      coverage: { start: '13:00:00', end: '14:00:00' },
      programType: 'health',
    },
    {
      id: 'documentary-night',
      text: '22:00到23:00安排纪录片',
      coverage: { start: '22:00:00', end: '23:00:00' },
      programType: 'documentary',
    },
    {
      id: 'kids-morning',
      text: '09:00到10:00安排少儿动画',
      coverage: { start: '09:00:00', end: '10:00:00' },
      programType: 'kids',
    },
    {
      id: 'commentary-evening',
      text: '18:00到19:00安排评论观察节目',
      coverage: { start: '18:00:00', end: '19:00:00' },
      programType: 'commentary',
    },
  ])('常见类型意图 $id 从自然语言草案确认后会正式编排对应节目', async ({ id, text, coverage, programType }) => {
    await prepareAndCommitNaturalLanguageDraft({
      conversationId: `conv-bridge-to-orchestrator-${id}`,
      text,
      expectedCoverage: coverage,
      expectedProgramType: programType,
    })

    const orchestrator = createOrchestrator()
    await orchestrator.startFullGeneration('dragon', date, coverage.start, coverage.end, {
      target: `${id}-e2e`,
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.some((item) => item.programType === programType)).toBe(true)
    expectNoOverlap(items)
  }, 20_000)
})
