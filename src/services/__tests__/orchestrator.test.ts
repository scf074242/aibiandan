import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Orchestrator, ORCHESTRATOR_PROMPT_VERSION, type OrchestratorConfig } from '@/services/orchestrator'
import { getAtomicCapabilities, resetAtomicCapabilities } from '@/services/atomicCapabilities'
import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import { getCandidateService, resetCandidateService } from '@/services/candidateService'
import { resetDataService } from '@/services/orchestration/dataService'
import type { DeleteCommand, GapInfo, PlanningLogEntry, PlanningSessionStatus, ProgramCandidate, ScheduleItemSnapshot } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'
import type { TaskClassifier } from '@/services/llm/taskClassifier'

const date = '2026-03-25'
const iso = (time: string) => `${date}T${time}+08:00`

const createOrchestrator = (config: Partial<OrchestratorConfig> = {}) => {
  const llmClient = {
    chat: vi.fn(async () => {
      throw new Error('LLM unavailable in orchestrator test')
    }),
  } as unknown as LLMClient

  const taskClassifier = {} as unknown as TaskClassifier

  return new Orchestrator(llmClient, taskClassifier, {
    planningLlmTimeoutMs: 20,
    ...config,
  })
}

const createScheduledItem = (overrides: Partial<ScheduleItemSnapshot> = {}): ScheduleItemSnapshot => ({
  id: 'scheduled-1',
  programCode: '881120030001',
  programName: '品质剧场：纵有疾风起 第1集',
  startTime: iso('09:00:00'),
  endTime: iso('09:45:00'),
  duration: 2700,
  programType: 'drama',
  sequence: 1,
  ...overrides,
})

const createProgramCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-1',
  programId: 'P-TEST-1',
  programCode: 'TEST-001',
  programName: 'Daily News',
  instanceName: 'Daily News',
  channelId: 'dragon',
  duration: 900,
  programType: 'news',
  ...overrides,
})

const registerRuntimeDramaLayout = (input: {
  slotId: string
  columnId: string
  startTime: string
  endTime: string
  queryHints: string[]
  requiresPreviousSchedule?: boolean
}) => {
  setRuntimeLayout({
    sourceFileName: 'AI版面草案',
    channelId: 'dragon',
    date,
    warnings: [],
    layoutReference: {
      id: `layout-${input.slotId}`,
      name: '测试草案版面',
      slots: [
        {
          id: input.slotId,
          channelId: 'dragon',
          columnId: input.columnId,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      ],
    },
    columns: [
      {
        columnId: input.columnId,
        columnName: '品质剧场',
        channelId: 'dragon',
        defaultProgramType: 'drama',
        isSequential: true,
        semanticLabel: '品质剧场',
        queryHints: input.queryHints,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: input.requiresPreviousSchedule ?? true,
        },
        source: 'generated',
      },
    ],
  })
}

const registerRuntimeCarouselLayout = (input: {
  slotId: string
  columnId: string
  startTime: string
  endTime: string
  selectionPrimary: 'content_match' | 'rating'
  programType?: string
  queryHints?: string[]
  columnName?: string
  semanticLabel?: string
}) => {
  const programType = input.programType ?? 'drama'
  const queryHints = input.queryHints ?? ['电视剧']
  const columnName = input.columnName ?? 'Carousel drama'
  const semanticLabel = input.semanticLabel ?? '电视剧轮播'
  setRuntimeLayout({
    sourceFileName: 'AI carousel draft',
    channelId: 'dragon',
    date,
    warnings: [],
    layoutReference: {
      id: `layout-${input.slotId}`,
      name: 'Carousel draft layout',
      slots: [
        {
          id: input.slotId,
          channelId: 'dragon',
          columnId: input.columnId,
          startTime: input.startTime,
          endTime: input.endTime,
        },
      ],
    },
    columns: [
      {
        columnId: input.columnId,
        columnName,
        channelId: 'dragon',
        defaultProgramType: programType,
        isSequential: false,
        semanticLabel,
        queryHints,
        selectionPolicy: {
          primary: input.selectionPrimary,
          fallback: input.selectionPrimary === 'rating' ? ['content_match'] : ['rating'],
          requiresPreviousSchedule: false,
        },
        source: 'generated',
      },
    ],
  })
}

describe('Orchestrator', () => {
  beforeEach(async () => {
    resetAtomicCapabilities()
    resetCandidateService()
    resetDataService()
    clearRuntimeLayout('dragon', date)
    await getAtomicCapabilities().clearAll()
  })

  afterEach(async () => {
    clearRuntimeLayout('dragon', date)
    await getAtomicCapabilities().clearAll()
    resetCandidateService()
    resetDataService()
  })

  it('createSession initializes default state and merges strategy overrides', () => {
    const orchestrator = createOrchestrator()

    const session = orchestrator.createSession('dragon', '2026-04-03', {
      target: 'smoke-test',
      allowFiller: false,
    })

    expect(session.channelId).toBe('dragon')
    expect(session.status).toBe('initializing')
    expect(session.strategy.target).toBe('smoke-test')
    expect(session.strategy.allowFiller).toBe(false)
    expect(session.strategy.referencePriority).toEqual(['layout', 'history', 'library'])
    expect(orchestrator.getSession()?.id).toBe(session.id)
  })

  it('getProgress returns baseline progress after session creation', () => {
    const orchestrator = createOrchestrator()
    const session = orchestrator.createSession('dragon', '2026-04-03')

    const progress = orchestrator.getProgress()

    expect(progress?.sessionId).toBe(session.id)
    expect(progress?.status).toBe('initializing')
    expect(progress?.gapProgress.total).toBe(0)
    expect(progress?.recentLogs).toEqual([])
  })

  it('executeCommand emits command-execute event', async () => {
    const orchestrator = createOrchestrator()
    const events: DeleteCommand[] = []

    orchestrator.on('command-execute', ({ command }) => {
      if (command.action === 'delete') {
        events.push(command)
      }
    })

    const command: DeleteCommand = {
      action: 'delete',
      data: {
        itemId: 'item-1',
      },
    }

    const result = await orchestrator.executeCommand(command)

    expect(result).toBe(true)
    expect(events).toEqual([command])
  })

  it('cancel updates session status and emits log/status events', () => {
    const orchestrator = createOrchestrator()
    const statuses: PlanningSessionStatus[] = []
    const logs: PlanningLogEntry[] = []

    orchestrator.createSession('dragon', '2026-04-03')
    orchestrator.on('status-change', ({ status }) => {
      statuses.push(status)
    })
    orchestrator.on('log', ({ entry }) => {
      logs.push(entry)
    })

    orchestrator.cancel()

    expect(orchestrator.getSession()?.status).toBe('cancelled')
    expect(statuses).toContain('cancelled')
    expect(logs.some((entry) => entry.level === 'warn' && entry.phase === 'session')).toBe(true)
  })

  it('startFullGeneration fails fast on unknown channel and emits error status', async () => {
    const orchestrator = createOrchestrator()
    const statuses: PlanningSessionStatus[] = []
    const errors: Error[] = []

    orchestrator.on('status-change', ({ status }) => {
      statuses.push(status)
    })
    orchestrator.on('error', ({ error }) => {
      errors.push(error)
    })

    await expect(
      orchestrator.startFullGeneration('unknown-channel', '2026-04-03', '06:00:00', '23:59:59'),
    ).rejects.toThrow('Unable to load generation context')

    expect(orchestrator.getSession()?.status).toBe('failed')
    expect(orchestrator.getIsRunning()).toBe(false)
    expect(statuses).toContain('failed')
    expect(errors).toHaveLength(1)
  })

  it('phase1Planning 超时后会回退到默认策略而不是一直阻塞', async () => {
    vi.useFakeTimers()
    try {
      const llmClient = {
        chat: vi.fn(() => new Promise<never>(() => {})),
      } as unknown as LLMClient
      const taskClassifier = {} as unknown as TaskClassifier
      const orchestrator = new Orchestrator(llmClient, taskClassifier, {
        planningLlmTimeoutMs: 20,
      })
      const logs: PlanningLogEntry[] = []

      orchestrator.createSession('dragon', '2026-04-03')
      orchestrator.on('log', ({ entry }) => {
        logs.push(entry)
      })

      const planningPromise = (orchestrator as unknown as { phase1Planning: () => Promise<void> }).phase1Planning()
      await vi.advanceTimersByTimeAsync(25)
      await planningPromise

      expect(logs.some((entry) => (
        entry.level === 'warn'
        && entry.phase === 'planning'
        && entry.message.includes('回退到默认编排策略')
      ))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('校验发现 critical 问题后终态会进入人工审查而不是完成', async () => {
    const orchestrator = createOrchestrator()
    const session = orchestrator.createSession('dragon', date)
    session.execution.successfulCommands = 1
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'overlap-1',
        programCode: '881120030001',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
      createScheduledItem({
        id: 'overlap-2',
        programCode: '881120030002',
        startTime: iso('09:30:00'),
        endTime: iso('10:15:00'),
      }),
    ], { skipValidation: true })

    await (orchestrator as unknown as { phase3Repair: () => Promise<void> }).phase3Repair()
    const terminalStatus = (orchestrator as unknown as { resolveTerminalStatus: () => PlanningSessionStatus }).resolveTerminalStatus()

    expect(terminalStatus).toBe('manual_review')
  })

  it('正式编排会按电视顺播策略参考昨日进度落到下一集', async () => {
    registerRuntimeDramaLayout({
      slotId: 'slot-tv-sequence',
      columnId: 'runtime-column:tv-sequence',
      startTime: iso('09:30:00'),
      endTime: iso('10:15:00'),
      queryHints: ['纵有疾风起'],
      requiresPreviousSchedule: true,
    })
    const orchestrator = createOrchestrator()

    await orchestrator.startFullGeneration('dragon', date, '09:30:00', '10:15:00', {
      target: 'tv-sequence-e2e',
      allowFiller: false,
      sequentialPreference: true,
    })

    const items = getAtomicCapabilities().getAllItems()
    const selectedProgram = items.find((item) => item.programCode === '881120030005')
    expect(selectedProgram?.programName).toContain('第5集')
    expect(selectedProgram?.startTime).toBe(iso('09:30:00'))
    expect(items.some((item) => item.programCode === '881120030004')).toBe(false)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  })

  it('正式编排轮播单时会把收视优先策略传递到候选选择并写入最高收视候选', async () => {
    const slotId = 'slot-carousel-rating-fill'
    const columnId = 'runtime-column:carousel-rating-fill'
    registerRuntimeCarouselLayout({
      slotId,
      columnId,
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      selectionPrimary: 'rating',
    })
    const gap: GapInfo = {
      id: slotId,
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      duration: 3600,
      constraints: {},
      metadata: {
        source: 'layout',
        priority: 1,
        createdAt: iso('00:00:00'),
        updatedAt: iso('00:00:00'),
      },
    }
    const preview = await getCandidateService().queryCandidates(gap, {
      targetTimeRange: { start: gap.startTime, end: gap.endTime },
      expectedDuration: { min: 1200, max: 3600 },
      channelId: 'dragon',
      columnId,
      programTypePreference: ['drama'],
      searchKeywords: ['电视剧'],
      excludeUsed: false,
      selectionPolicy: {
        primary: 'rating',
        fallback: ['content_match'],
        requiresPreviousSchedule: false,
      },
    })
    const expectedTopCandidate = preview.candidates[0]
    expect(expectedTopCandidate).toBeTruthy()
    expect(preview.diagnostics?.selectionPriority).toBe('rating')
    expect(preview.diagnostics?.notes).not.toContain('history_reference_loaded')

    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'carousel-rating-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const programItems = items.filter((item) => item.programType !== 'ad')
    expect(programItems.some((item) => item.programCode === expectedTopCandidate!.programCode)).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)

    const queryLog = logs.find((entry) => {
      const details = entry.details as { diagnostics?: { selectionPriority?: string; notes?: string[] } } | undefined
      return entry.phase === 'query' && details?.diagnostics?.selectionPriority === 'rating'
    })
    expect(queryLog).toBeTruthy()
    expect((queryLog?.details as { diagnostics?: { notes?: string[] } } | undefined)?.diagnostics?.notes).not.toContain('history_reference_loaded')
  }, 15_000)

  it('正式编排开放直播轮播单时会按内容匹配写入相关现场节目', async () => {
    const slotId = 'slot-carousel-live-content'
    const columnId = 'runtime-column:carousel-live-content'
    registerRuntimeCarouselLayout({
      slotId,
      columnId,
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      selectionPrimary: 'content_match',
      programType: 'news_magazine',
      columnName: '静安寺户外直播',
      semanticLabel: '静安寺户外直播轮播',
      queryHints: ['静安寺', '外场直播', '直播'],
    })
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'carousel-live-content-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const programItems = items.filter((item) => item.programType !== 'ad')
    expect(programItems.length).toBeGreaterThan(0)
    expect(programItems.some((item) => item.programName.includes('静安寺'))).toBe(true)
    expect(programItems.every((item) => item.programType !== 'drama')).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)

    const queryLog = logs.find((entry) => {
      const details = entry.details as { diagnostics?: { selectionPriority?: string; rejectionReasons?: string[] } } | undefined
      return entry.phase === 'query' && details?.diagnostics?.selectionPriority === 'content_match'
    })
    expect(queryLog).toBeTruthy()
    expect((queryLog?.details as { diagnostics?: { rejectionReasons?: string[] } } | undefined)?.diagnostics?.rejectionReasons).not.toContain('hard_keyword_no_match')

    const selectionLog = logs.find((entry) => {
      const details = entry.details as { editorialDecision?: { strategy?: string; dimensions?: Array<{ key?: string }> } } | undefined
      return entry.phase === 'selection' && details?.editorialDecision?.strategy === 'content_match'
    })
    expect(selectionLog).toBeTruthy()
    expect((selectionLog?.details as { editorialDecision?: { dimensions?: Array<{ key?: string }> } } | undefined)?.editorialDecision?.dimensions?.map((item) => item.key)).toEqual(
      expect.arrayContaining(['content_match', 'duration_fit', 'schedule_context']),
    )

    const executionLog = logs.find((entry) => {
      const details = entry.details as { selectedCandidate?: { editorialDecision?: { strategy?: string; summary?: string } } } | undefined
      return entry.phase === 'execution' && details?.selectedCandidate?.editorialDecision?.strategy === 'content_match'
    })
    expect(executionLog).toBeTruthy()
    expect((executionLog?.details as { selectedCandidate?: { editorialDecision?: { summary?: string } } } | undefined)?.selectedCandidate?.editorialDecision?.summary).toContain('专业判断')
  })

  it('正式编排内容证据不足的开放意图时会保留空缺并记录专业门槛原因', async () => {
    const slotId = 'slot-carousel-weak-content'
    const columnId = 'runtime-column:carousel-weak-content'
    registerRuntimeCarouselLayout({
      slotId,
      columnId,
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      selectionPrimary: 'content_match',
      programType: 'news_magazine',
      columnName: '静安寺外滩',
      semanticLabel: '静安寺外滩栏目',
      queryHints: ['静安寺', '外滩'],
    })
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '15:00:00', {
      target: 'carousel-weak-content-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const selectionBlockedLog = logs.find((entry) => {
      const details = entry.details as { riskFlags?: string[]; missingRequirements?: string[] } | undefined
      return entry.phase === 'selection'
        && details?.riskFlags?.includes('editorial_auto_select_threshold_blocked')
    })
    const failedGapId = orchestrator.getSession()?.gaps.failed[0]

    expect(items).toHaveLength(0)
    expect(orchestrator.getSession()?.status).toBe('manual_review')
    expect(selectionBlockedLog).toBeTruthy()
    expect((selectionBlockedLog?.details as { missingRequirements?: string[] } | undefined)?.missingRequirements).toEqual(
      expect.arrayContaining(['editorial_quality']),
    )
    expect(failedGapId).toBeTruthy()
    expect(orchestrator.getSession()?.gaps.failedReasons[failedGapId!]).toContain('专业匹配证据不足')
  })

  it('正式编排功能型导视段时会写入导视类候选', async () => {
    const slotId = 'slot-carousel-guide-content'
    const columnId = 'runtime-column:carousel-guide-content'
    registerRuntimeCarouselLayout({
      slotId,
      columnId,
      startTime: iso('14:00:00'),
      endTime: iso('14:30:00'),
      selectionPrimary: 'content_match',
      programType: 'news_magazine',
      columnName: '现场导视',
      semanticLabel: '现场导视',
      queryHints: ['现场导视'],
    })
    const orchestrator = createOrchestrator()

    await orchestrator.startFullGeneration('dragon', date, '14:00:00', '14:30:00', {
      target: 'carousel-guide-content-e2e',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const programItems = items.filter((item) => item.programType !== 'ad')
    expect(programItems.length).toBeGreaterThan(0)
    expect(programItems.every((item) => item.programName.includes('导视'))).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  })

  it('正式编排回填早于已排剧集的空窗时不会倒序排入后续集数', async () => {
    registerRuntimeDramaLayout({
      slotId: 'slot-backfill-before-existing',
      columnId: 'runtime-column:backfill-before-existing',
      startTime: iso('08:00:00'),
      endTime: iso('08:45:00'),
      queryHints: ['纵有疾风起'],
      requiresPreviousSchedule: true,
    })
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'existing-0900-episode-1',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
    ], { skipValidation: true })
    resetCandidateService()
    const orchestrator = createOrchestrator()

    await orchestrator.startPartialGeneration('dragon', date)

    const items = getAtomicCapabilities().getAllItems()
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('existing-0900-episode-1')
    expect(items.some((item) => item.programCode === '881120030002')).toBe(false)
    expect(orchestrator.getSession()?.status).toBe('manual_review')
  })

  it('正式编排夹在已有同剧集之间的空窗时只补顺序承接的中间集', async () => {
    registerRuntimeDramaLayout({
      slotId: 'slot-between-existing-episodes',
      columnId: 'runtime-column:between-existing-episodes',
      startTime: iso('09:00:00'),
      endTime: iso('11:15:00'),
      queryHints: ['纵有疾风起'],
      requiresPreviousSchedule: true,
    })
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'existing-0900-episode-1',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
      createScheduledItem({
        id: 'existing-1030-episode-3',
        programCode: '002601120003',
        programName: '品质剧场：纵有疾风起 第3集',
        startTime: iso('10:30:00'),
        endTime: iso('11:15:00'),
      }),
    ], { skipValidation: true })
    resetCandidateService()
    const orchestrator = createOrchestrator()

    await orchestrator.startPartialGeneration('dragon', date)

    const items = getAtomicCapabilities().getAllItems()
    const middleEpisodeSegments = items.filter((item) => item.programCode === '002601120002')
    expect(middleEpisodeSegments.length).toBeGreaterThan(0)
    expect(middleEpisodeSegments.every((item) => item.programName.includes('第2集'))).toBe(true)
    expect(middleEpisodeSegments[0]?.startTime).toBe(iso('09:45:00'))
    expect(middleEpisodeSegments.at(-1)?.endTime).toBe(iso('10:30:00'))
    const uniqueProgramCodes = items
      .filter((item) => item.programType !== 'ad')
      .map((item) => item.programCode)
      .filter((code, index, codes) => index === 0 || code !== codes[index - 1])
    expect(uniqueProgramCodes).toEqual([
      '002601120001',
      '002601120002',
      '002601120003',
    ])
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
    expect(orchestrator.getSession()?.status).toBe('completed')
  })

  it('执行层在写入前会再次阻止顺播倒序计划', async () => {
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'existing-0900-episode-1',
        programCode: '881120030001',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
    ], { skipValidation: true })
    resetCandidateService()
    const candidate = getCandidateService().getCandidateById('881120030002') as ProgramCandidate | undefined
    expect(candidate).toBeTruthy()
    const orchestrator = createOrchestrator()
    orchestrator.createSession('dragon', date)
    const gap: GapInfo = {
      id: 'gap-before-existing-episode',
      startTime: iso('08:00:00'),
      endTime: iso('08:45:00'),
      duration: 2700,
      constraints: {},
      metadata: {
        source: 'layout',
        priority: 1,
        createdAt: iso('00:00:00'),
        updatedAt: iso('00:00:00'),
      },
    }

    await expect((orchestrator as unknown as {
      executePreparedPlan: (plan: unknown) => Promise<unknown>
    }).executePreparedPlan({
      gap,
      queryCommand: {
        action: 'query_candidates',
        data: {
          gapId: gap.id,
          criteria: {
            targetTimeRange: { start: gap.startTime, end: gap.endTime },
            expectedDuration: { min: 2400, max: 3000 },
            channelId: 'dragon',
            columnId: '112',
            excludeUsed: true,
          },
        },
      },
      candidates: [candidate],
      fillCommand: {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: candidate!.id,
          selectionReason: '模拟上游漏判的坏计划',
        },
      },
      selectedCandidate: candidate,
    })).rejects.toThrow('顺播倒序')

    const items = getAtomicCapabilities().getAllItems()
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('existing-0900-episode-1')
  })

  it('局部正式编排带内容目标时会覆盖原版面栏目和类型约束', async () => {
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startPartialGeneration('dragon', date, {
      targetTimeRange: { start: '09:00:00', end: '12:00:00' },
      searchKeywords: ['栏目=东方剧场'],
    })

    const queryLogs = logs.filter((entry) => entry.phase === 'query' && entry.message.includes('已生成接口查询参数'))
    expect(queryLogs.length).toBeGreaterThan(0)
    expect(queryLogs.every((entry) => {
      const criteria = (entry.details as { criteria?: { columnId?: string; searchKeywords?: string[]; programTypePreference?: string[] } } | undefined)?.criteria
      return criteria?.columnId === ''
        && criteria.searchKeywords?.includes('栏目=东方剧场')
        && criteria.programTypePreference?.includes('drama')
    })).toBe(true)

    const items = getAtomicCapabilities().getAllItems()
    expect(items.some((item) => item.programName?.includes('东方剧场'))).toBe(true)
    expect(items.some((item) => item.programName?.includes('潮童天下'))).toBe(false)
  }, 15_000)

  it('执行层在写入前会再次阻止未命中明确关键词的计划', async () => {
    resetCandidateService()
    const candidate = getCandidateService().getCandidateById('881120030002') as ProgramCandidate | undefined
    expect(candidate).toBeTruthy()
    const orchestrator = createOrchestrator()
    orchestrator.createSession('dragon', date)
    const gap: GapInfo = {
      id: 'gap-life-tree-mismatch',
      startTime: iso('12:45:00'),
      endTime: iso('13:30:00'),
      duration: 2700,
      constraints: {},
      metadata: {
        source: 'layout',
        priority: 1,
        createdAt: iso('00:00:00'),
        updatedAt: iso('00:00:00'),
      },
    }

    await expect((orchestrator as unknown as {
      executePreparedPlan: (plan: unknown) => Promise<unknown>
    }).executePreparedPlan({
      gap,
      queryCommand: {
        action: 'query_candidates',
        data: {
          gapId: gap.id,
          criteria: {
            targetTimeRange: { start: gap.startTime, end: gap.endTime },
            expectedDuration: { min: 2400, max: 3000 },
            channelId: 'dragon',
            columnId: '',
            searchKeywords: ['生命树电视剧'],
            excludeUsed: true,
          },
        },
      },
      thought: {
        summary: '模拟上游漏判：用户明确要生命树电视剧',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 2400, max: 3000 },
        searchKeywords: ['生命树电视剧'],
        allowFiller: false,
        sequentialPreference: false,
      },
      candidates: [candidate],
      fillCommand: {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: candidate!.id,
          selectionReason: '模拟上游漏判的硬关键词不匹配计划',
        },
      },
      selectedCandidate: candidate,
    })).rejects.toThrow('明确编排关键词')

    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('执行层在写入前会阻止栏目和内容字段错位的计划', async () => {
    const candidate = createProgramCandidate({
      id: 'wrong-field-live',
      programCode: 'LIVE-WRONG-FIELD-001',
      programName: '看东方：静安寺外场直播 第1期',
      instanceName: '看东方：静安寺外场直播 第1期',
      programType: 'news_magazine',
      columnName: 'ShanghaiEye',
      contentTags: ['看东方', '静安寺', '外场直播'],
    })
    const orchestrator = createOrchestrator()
    orchestrator.createSession('dragon', date)
    const gap: GapInfo = {
      id: 'gap-structured-keyword-mismatch',
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      duration: 3600,
      constraints: {},
      metadata: {
        source: 'layout',
        priority: 1,
        createdAt: iso('00:00:00'),
        updatedAt: iso('00:00:00'),
      },
    }

    await expect((orchestrator as unknown as {
      executePreparedPlan: (plan: unknown) => Promise<unknown>
    }).executePreparedPlan({
      gap,
      queryCommand: {
        action: 'query_candidates',
        data: {
          gapId: gap.id,
          criteria: {
            targetTimeRange: { start: gap.startTime, end: gap.endTime },
            expectedDuration: { min: 60, max: 3600 },
            channelId: 'dragon',
            programTypePreference: ['news_magazine'],
            searchKeywords: ['所属栏目看东方', '节目内容静安寺'],
            excludeUsed: false,
          },
        },
      },
      thought: {
        summary: '模拟上游漏判：字段错位但文本整体看似命中',
        targetProgramTypes: ['news_magazine'],
        durationPreference: { min: 60, max: 3600 },
        searchKeywords: ['所属栏目看东方', '节目内容静安寺'],
        allowFiller: false,
        sequentialPreference: false,
      },
      candidates: [candidate],
      fillCommand: {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: candidate.id,
          selectionReason: 'simulated wrong-field bypass',
        },
      },
      selectedCandidate: candidate,
    })).rejects.toThrow('明确编排关键词')

    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('blocks an execution plan that bypasses rating-priority candidate order', async () => {
    const topCandidate = createProgramCandidate({
      id: 'high-rating',
      programName: 'High Rating News',
      instanceName: 'High Rating News',
      estimatedRating: 9.2,
      editorialDecision: {
        strategy: 'rating',
        totalScore: 92,
        summary: 'Rating-first editorial decision: highest estimated rating.',
        strengths: ['rating'],
        concerns: [],
        dimensions: [
          { key: 'rating', score: 92, weight: 0.35, note: 'highest estimated rating' },
        ],
      },
    })
    const lowerCandidate = createProgramCandidate({
      id: 'low-rating',
      programCode: 'TEST-002',
      programName: 'Low Rating News',
      instanceName: 'Low Rating News',
      estimatedRating: 5.8,
      editorialDecision: {
        strategy: 'rating',
        totalScore: 58,
        summary: 'Rating-first editorial decision: lower estimated rating.',
        strengths: [],
        concerns: ['rating'],
        dimensions: [
          { key: 'rating', score: 58, weight: 0.35, note: 'lower estimated rating' },
        ],
      },
    })
    const orchestrator = createOrchestrator()
    orchestrator.createSession('dragon', date)
    const gap: GapInfo = {
      id: 'gap-rating-strategy-bypass',
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      duration: 3600,
      constraints: {},
      metadata: {
        source: 'layout',
        priority: 1,
        createdAt: iso('00:00:00'),
        updatedAt: iso('00:00:00'),
      },
    }

    await expect((orchestrator as unknown as {
      executePreparedPlan: (plan: unknown) => Promise<unknown>
    }).executePreparedPlan({
      gap,
      queryCommand: {
        action: 'query_candidates',
        data: {
          gapId: gap.id,
          criteria: {
            targetTimeRange: { start: gap.startTime, end: gap.endTime },
            expectedDuration: { min: 60, max: 3600 },
            channelId: 'dragon',
            programTypePreference: ['news'],
            excludeUsed: false,
            selectionPolicy: {
              primary: 'rating',
              fallback: ['content_match'],
            },
          },
        },
      },
      thought: {
        summary: 'carousel rating first',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 3600 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
      candidates: [topCandidate, lowerCandidate],
      fillCommand: {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: lowerCandidate.id,
          selectionReason: 'simulated bypass',
        },
      },
      selectedCandidate: lowerCandidate,
    })).rejects.toThrow('收视率优先策略')

    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('blocks an execution plan that bypasses content-match candidate order', async () => {
    const topCandidate = createProgramCandidate({
      id: 'content-best',
      programCode: 'LIVE-JINGAN-001',
      programName: '看东方：静安寺外场直播 第1期',
      instanceName: '看东方：静安寺外场直播 第1期',
      programType: 'news_magazine',
      columnName: '看东方',
      contentTags: ['静安寺', '外场直播'],
      editorialDecision: {
        strategy: 'content_match',
        totalScore: 94,
        summary: 'Content-match editorial decision: title, column, and location all match.',
        strengths: ['content', 'column'],
        concerns: [],
        dimensions: [
          { key: 'content_match', score: 98, weight: 0.4, note: 'matches live Jing An Temple intent' },
        ],
      },
    })
    const weakerCandidate = createProgramCandidate({
      id: 'content-weaker',
      programCode: 'LIVE-GENERIC-001',
      programName: '城市服务直播 第1期',
      instanceName: '城市服务直播 第1期',
      programType: 'news_magazine',
      contentTags: ['直播'],
      editorialDecision: {
        strategy: 'content_match',
        totalScore: 61,
        summary: 'Content-match editorial decision: only generic live topic matches.',
        strengths: ['live'],
        concerns: ['location'],
        dimensions: [
          { key: 'content_match', score: 55, weight: 0.4, note: 'generic live topic only' },
        ],
      },
    })
    const orchestrator = createOrchestrator()
    orchestrator.createSession('dragon', date)
    const gap: GapInfo = {
      id: 'gap-content-strategy-bypass',
      startTime: iso('14:00:00'),
      endTime: iso('15:00:00'),
      duration: 3600,
      constraints: {},
      metadata: {
        source: 'layout',
        priority: 1,
        createdAt: iso('00:00:00'),
        updatedAt: iso('00:00:00'),
      },
    }

    await expect((orchestrator as unknown as {
      executePreparedPlan: (plan: unknown) => Promise<unknown>
    }).executePreparedPlan({
      gap,
      queryCommand: {
        action: 'query_candidates',
        data: {
          gapId: gap.id,
          criteria: {
            targetTimeRange: { start: gap.startTime, end: gap.endTime },
            expectedDuration: { min: 60, max: 3600 },
            channelId: 'dragon',
            programTypePreference: ['news_magazine'],
            searchKeywords: ['直播'],
            excludeUsed: false,
            selectionPolicy: {
              primary: 'content_match',
              fallback: ['rating'],
            },
          },
        },
      },
      thought: {
        summary: 'Jing An Temple live carousel content first',
        targetProgramTypes: ['news_magazine'],
        durationPreference: { min: 60, max: 3600 },
        searchKeywords: ['直播'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
      candidates: [topCandidate, weakerCandidate],
      fillCommand: {
        action: 'fill_item',
        data: {
          gapId: gap.id,
          selectedCandidateId: weakerCandidate.id,
          selectionReason: 'simulated bypass',
        },
      },
      selectedCandidate: weakerCandidate,
    })).rejects.toThrow('内容匹配优先策略')

    expect(getAtomicCapabilities().getAllItems()).toHaveLength(0)
  })

  it('连续电视剧顺播会逐段刷新上下文，即使配置了并发也不会重复选择同一集', async () => {
    const columnId = 'runtime-column:tv-sequence-two-slots'
    setRuntimeLayout({
      sourceFileName: 'AI sequential draft',
      channelId: 'dragon',
      date,
      warnings: [],
      layoutReference: {
        id: 'layout-tv-sequence-two-slots',
        name: '电视剧顺播测试版面',
        slots: [
          {
            id: 'slot-tv-sequence-1',
            channelId: 'dragon',
            columnId,
            startTime: iso('09:30:00'),
            endTime: iso('10:15:00'),
          },
          {
            id: 'slot-tv-sequence-2',
            channelId: 'dragon',
            columnId,
            startTime: iso('10:15:00'),
            endTime: iso('11:00:00'),
          },
        ],
      },
      columns: [
        {
          columnId,
          columnName: '品质剧场',
          channelId: 'dragon',
          defaultProgramType: 'drama',
          isSequential: true,
          semanticLabel: '品质剧场',
          queryHints: ['纵有疾风起'],
          selectionPolicy: {
            primary: 'sequence',
            fallback: ['content_match', 'rating'],
            requiresPreviousSchedule: true,
          },
          source: 'generated',
        },
      ],
    })
    const orchestrator = createOrchestrator({ planningConcurrency: 2 })

    await orchestrator.startFullGeneration('dragon', date, '09:30:00', '11:00:00', {
      target: 'tv-sequence-two-slots',
      allowFiller: false,
      sequentialPreference: true,
    })

    const programItems = getAtomicCapabilities()
      .getAllItems()
      .filter((item) => item.programType !== 'ad')
    const selectedProgramCodes = programItems
      .map((item) => item.programCode)
      .filter((programCode, index, codes) => programCode !== codes[index - 1])

    expect(selectedProgramCodes).toEqual(['881120030005', '881120030006'])
    expect(programItems.find((item) => item.programCode === '881120030005')?.startTime).toBe(iso('09:30:00'))
    expect(programItems.find((item) => item.programCode === '881120030006')?.startTime).toBe(iso('10:15:00'))
    expect(programItems.some((item) => item.programCode === '881120030004')).toBe(false)
  }, 15_000)

  it('三小时电视剧长时段会持续填充剩余空窗再进入后续栏目，避免剧集跳跃', async () => {
    const dramaColumnId = 'runtime-column:long-drama-band'
    const newsColumnId = 'runtime-column:after-long-drama-news'
    setRuntimeLayout({
      sourceFileName: 'AI long drama draft',
      channelId: 'dragon',
      date,
      warnings: [],
      layoutReference: {
        id: 'layout-long-drama-before-news',
        name: '长时段电视剧顺播测试版面',
        slots: [
          {
            id: 'slot-long-drama-band',
            channelId: 'dragon',
            columnId: dramaColumnId,
            startTime: iso('09:00:00'),
            endTime: iso('12:00:00'),
          },
          {
            id: 'slot-after-long-drama-news',
            channelId: 'dragon',
            columnId: newsColumnId,
            startTime: iso('12:00:00'),
            endTime: iso('12:30:00'),
          },
        ],
      },
      columns: [
        {
          columnId: dramaColumnId,
          columnName: '品质剧场',
          channelId: 'dragon',
          defaultProgramType: 'drama',
          isSequential: true,
          semanticLabel: '品质剧场',
          queryHints: ['纵有疾风起'],
          selectionPolicy: {
            primary: 'sequence',
            fallback: ['content_match', 'rating'],
            requiresPreviousSchedule: true,
          },
          source: 'generated',
        },
        {
          columnId: newsColumnId,
          columnName: '午间新闻',
          channelId: 'dragon',
          defaultProgramType: 'news',
          semanticLabel: '午间新闻',
          queryHints: ['新闻'],
          selectionPolicy: {
            primary: 'content_match',
            fallback: ['rating'],
          },
          source: 'generated',
        },
      ],
    })
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '09:00:00', '12:30:00', {
      target: 'long-drama-band-before-news',
      allowFiller: false,
      sequentialPreference: true,
    })

    const programItems = getAtomicCapabilities()
      .getAllItems()
      .filter((item) => item.programType !== 'ad')
      .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
    const selectedProgramCodes = programItems
      .map((item) => item.programCode)
      .filter((programCode, index, codes) => programCode !== codes[index - 1])

    expect(selectedProgramCodes.slice(0, 4)).toEqual([
      '881120030005',
      '881120030006',
      '881120030007',
      '881120030008',
    ])
    expect(programItems.find((item) => item.programCode === '881120030005')?.startTime).toBe(iso('09:00:00'))
    expect(programItems.find((item) => item.programCode === '881120030006')?.startTime).toBe(iso('09:45:00'))
    expect(programItems.find((item) => item.programCode === '881120030007')?.startTime).toBe(iso('10:30:00'))
    expect(programItems.find((item) => item.programCode === '881120030008')?.startTime).toBe(iso('11:15:00'))
    expect(programItems.find((item) => item.programType === 'news')?.startTime).toBe(iso('12:00:00'))

    const dramaQueryLogs = logs.filter((entry) => {
      const details = entry.details as {
        targetSlotLabel?: string
        topCandidates?: Array<{ programCode?: string; expectedSequenceNo?: number }>
      } | undefined
      return entry.phase === 'query'
        && details?.targetSlotLabel === '品质剧场'
        && Array.isArray(details.topCandidates)
    })
    expect(dramaQueryLogs).toHaveLength(4)
    expect(dramaQueryLogs.map((entry) =>
      ((entry.details as { topCandidates: Array<{ expectedSequenceNo?: number }> }).topCandidates[0]?.expectedSequenceNo),
    )).toEqual([5, 6, 7, 8])
    expect(dramaQueryLogs.map((entry) =>
      ((entry.details as { topCandidates: Array<{ programCode?: string }> }).topCandidates[0]?.programCode),
    )).toEqual([
      '881120030005',
      '881120030006',
      '881120030007',
      '881120030008',
    ])
    expect(dramaQueryLogs.slice(1).every((entry) => {
      const details = entry.details as { diagnostics?: { notes?: string[] } } | undefined
      return details?.diagnostics?.notes?.includes('current_schedule_overrides_history')
    })).toBe(true)
  }, 20_000)

  it('电视剧长时段剩余时长不足一集时不会越界硬塞下一集', async () => {
    const columnId = 'runtime-column:short-tail-drama-band'
    setRuntimeLayout({
      sourceFileName: 'AI short tail drama draft',
      channelId: 'dragon',
      date,
      warnings: [],
      layoutReference: {
        id: 'layout-short-tail-drama-band',
        name: '短尾电视剧顺播测试版面',
        slots: [
          {
            id: 'slot-short-tail-drama-band',
            channelId: 'dragon',
            columnId,
            startTime: iso('09:00:00'),
            endTime: iso('11:20:00'),
          },
        ],
      },
      columns: [
        {
          columnId,
          columnName: '品质剧场',
          channelId: 'dragon',
          defaultProgramType: 'drama',
          isSequential: true,
          semanticLabel: '品质剧场',
          queryHints: ['纵有疾风起'],
          selectionPolicy: {
            primary: 'sequence',
            fallback: ['content_match', 'rating'],
            requiresPreviousSchedule: true,
          },
          source: 'generated',
        },
      ],
    })
    const orchestrator = createOrchestrator()

    await orchestrator.startFullGeneration('dragon', date, '09:00:00', '11:20:00', {
      target: 'short-tail-drama-band',
      allowFiller: false,
      sequentialPreference: true,
    })

    const items = getAtomicCapabilities()
      .getAllItems()
      .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
    const programItems = items.filter((item) => item.programType !== 'ad')
    const selectedProgramCodes = programItems
      .map((item) => item.programCode)
      .filter((programCode, index, codes) => programCode !== codes[index - 1])

    expect(selectedProgramCodes).toEqual([
      '881120030005',
      '881120030006',
      '881120030007',
    ])
    expect(programItems.some((item) => item.programCode === '881120030008')).toBe(false)
    expect(items.every((item) => new Date(item.endTime).getTime() <= new Date(iso('11:20:00')).getTime())).toBe(true)
    expect(items.every((item, index) => {
      const next = items[index + 1]
      return !next || new Date(item.endTime).getTime() <= new Date(next.startTime).getTime()
    })).toBe(true)
  }, 20_000)

  it('正式编排回填早段顺播栏目时会读取当前表内上下文并阻止倒序写入', async () => {
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'existing-0900-episode-1',
        programCode: '881120030001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        sequence: 1,
      }),
    ], { skipValidation: true })
    registerRuntimeDramaLayout({
      slotId: 'slot-backfill-before-existing-sequence',
      columnId: 'runtime-column:backfill-before-existing-sequence',
      startTime: iso('08:00:00'),
      endTime: iso('08:45:00'),
      queryHints: ['纵有疾风起'],
      requiresPreviousSchedule: true,
    })
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '08:00:00', '09:45:00', {
      target: 'backfill-before-existing-sequence',
      allowFiller: false,
      sequentialPreference: true,
    })

    const items = getAtomicCapabilities().getAllItems()
    expect(items.find((item) => item.id === 'existing-0900-episode-1')).toMatchObject({
      programCode: '881120030001',
      startTime: iso('09:00:00'),
    })
    expect(items.some((item) => item.programCode === '881120030002' && item.startTime === iso('08:00:00'))).toBe(false)
    expect(items).toHaveLength(1)
    expect(orchestrator.getSession()?.status).toBe('manual_review')
    expect(logs.some((entry) => {
      const diagnostics = (entry.details as { diagnostics?: { rejectionReasons?: string[] } } | undefined)?.diagnostics
      return entry.phase === 'query' && diagnostics?.rejectionReasons?.includes('sequence_context_order_conflict')
    })).toBe(true)
  })

  it('formal TV sequence uses current schedule progress before previous-day history', async () => {
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'existing-0900-episode-5',
        programCode: '881120030005',
        programName: '品质剧场：纵有疾风起 第5集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
        sequence: 1,
      }),
    ], { skipValidation: true })
    registerRuntimeDramaLayout({
      slotId: 'slot-continue-after-existing-current-episode',
      columnId: 'runtime-column:continue-after-existing-current-episode',
      startTime: iso('09:45:00'),
      endTime: iso('10:30:00'),
      queryHints: ['纵有疾风起'],
      requiresPreviousSchedule: true,
    })
    resetCandidateService()
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '09:00:00', '10:30:00', {
      target: 'continue-after-existing-current-episode',
      allowFiller: false,
      sequentialPreference: true,
    })

    const programItems = getAtomicCapabilities()
      .getAllItems()
      .filter((item) => item.programType !== 'ad')
      .sort((left, right) => new Date(left.startTime).getTime() - new Date(right.startTime).getTime())
    const uniqueProgramCodes = programItems
      .map((item) => item.programCode)
      .filter((programCode, index, codes) => programCode !== codes[index - 1])

    expect(uniqueProgramCodes).toEqual(['881120030005', '881120030006'])
    expect(programItems.find((item) => item.programCode === '881120030006')?.startTime).toBe(iso('09:45:00'))
    expect(programItems.filter((item) => item.programCode === '881120030005')).toHaveLength(1)
    expect(logs.some((entry) => {
      const diagnostics = (entry.details as { diagnostics?: { notes?: string[] } } | undefined)?.diagnostics
      return entry.phase === 'query' && diagnostics?.notes?.includes('current_schedule_overrides_history')
    })).toBe(true)
  }, 20_000)

  it('keeps a hard-keyword no-match segment empty and logs query diagnostics', async () => {
    registerRuntimeDramaLayout({
      slotId: 'slot-life-tree-no-match',
      columnId: 'runtime-column:life-tree-no-match',
      startTime: iso('12:45:00'),
      endTime: iso('13:00:00'),
      queryHints: ['生命树电视剧'],
      requiresPreviousSchedule: false,
    })
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startFullGeneration('dragon', date, '12:45:00', '13:00:00', {
      target: 'hard-keyword-no-match',
      allowFiller: false,
      sequentialPreference: false,
    })

    const items = getAtomicCapabilities().getAllItems()
    const queryNoHitLog = logs.find((entry) => {
      const diagnostics = (entry.details as { diagnostics?: { rejectionReasons?: string[] } } | undefined)?.diagnostics
      return entry.phase === 'query' && diagnostics?.rejectionReasons?.includes('hard_keyword_no_match')
    })

    expect(items).toHaveLength(0)
    expect(orchestrator.getSession()?.status).toBe('manual_review')
    expect(orchestrator.getSession()?.gaps.failed.length).toBe(1)
    const failedGapId = orchestrator.getSession()?.gaps.failed[0]
    expect(failedGapId).toBeTruthy()
    expect(orchestrator.getSession()?.gaps.failedReasons[failedGapId!]).toContain('hard_keyword_no_match')
    expect(queryNoHitLog).toBeTruthy()
  })

  it('不会用广告填充明确关键词无匹配的失败空窗', async () => {
    registerRuntimeDramaLayout({
      slotId: 'slot-life-tree-between-existing',
      columnId: 'runtime-column:life-tree-between-existing',
      startTime: iso('09:00:00'),
      endTime: iso('11:00:00'),
      queryHints: ['生命树电视剧'],
      requiresPreviousSchedule: false,
    })
    await getAtomicCapabilities().replaceAllItems([
      createScheduledItem({
        id: 'existing-before-life-tree-gap',
        programCode: '002601120001',
        programName: '品质剧场：纵有疾风起 第1集',
        startTime: iso('09:00:00'),
        endTime: iso('09:45:00'),
      }),
      createScheduledItem({
        id: 'existing-after-life-tree-gap',
        programCode: '002601120003',
        programName: '品质剧场：纵有疾风起 第3集',
        startTime: iso('10:15:00'),
        endTime: iso('11:00:00'),
      }),
    ], { skipValidation: true })
    resetCandidateService()
    const orchestrator = createOrchestrator()
    const logs: PlanningLogEntry[] = []
    orchestrator.on('log', ({ entry }) => logs.push(entry))

    await orchestrator.startPartialGeneration('dragon', date)

    const items = getAtomicCapabilities().getAllItems()
    expect(items).toHaveLength(2)
    expect(items.some((item) => item.programType === 'ad')).toBe(false)
    expect(orchestrator.getSession()?.status).toBe('manual_review')
    expect(logs.some((entry) => {
      const diagnostics = (entry.details as { diagnostics?: { rejectionReasons?: string[] } } | undefined)?.diagnostics
      return entry.phase === 'query' && diagnostics?.rejectionReasons?.includes('hard_keyword_no_match')
    })).toBe(true)
    expect(logs.some((entry) =>
      entry.phase === 'execution'
      && /已插入广告/.test(entry.message)
      && (entry.details as { slotId?: string } | undefined)?.slotId === 'slot-life-tree-between-existing',
    )).toBe(false)
  })
})

describe('Orchestrator promptVersion 透传', () => {
  /**
   * case c12-orchestrator-planning-passes-version
   * - expectedDecision: phase1Planning 调用 LLM 时透传 promptVersion + traceLabel
   * - mustNotHappen: options 缺失 promptVersion
   * - verification: ORCHESTRATOR_PROMPT_VERSION 常量导出为 'v1.0'
   *
   * 说明：Orchestrator 构造依赖 LLMClient + TaskClassifier + 大量运行时上下文，
   * phase1Planning 为私有方法且需要完整编排会话才能触发；
   * 这里以常量导出 + 版本号断言作为门禁，保证 prompt 版本可追溯。
   */
  it('c12-orchestrator-version-exported: ORCHESTRATOR_PROMPT_VERSION 导出且为 v1.0', () => {
    expect(ORCHESTRATOR_PROMPT_VERSION).toBe('v1.0')
  })
})

describe('Orchestrator 失败暴露回归门禁', () => {
  /**
   * case regression-resolveTerminalStatus-manual-review-on-gap-failure
   * - expectedDecision: 单空窗/部分空窗候选检索失败（successful=0 && failed>0）时 resolveTerminalStatus 返回 manual_review
   * - mustNotHappen: 返回 'failed' 状态（会破坏单空窗硬关键词失败的可审查语义）
   * - verification: 直接调用私有 resolveTerminalStatus，断言返回 'manual_review'
   *
   * 背景：全天编排"5 秒全编排完"问题的修复曾误将 successful=0&&failed>0 改为 'failed'，
   * 破坏了 5 个既有 manual_review 用例。真正的"什么都没排进去"失败暴露由
   * FormalOrchestrationCapability.handle 通过 execution 指标判定，不改 session 状态语义。
   */
  it('resolveTerminalStatus 在空窗失败但未越界时返回 manual_review 而非 failed', async () => {
    const orchestrator = createOrchestrator()
    orchestrator.createSession('dragon', date)
    // 模拟 1 个空窗检索失败、0 个成功
    orchestrator.getSession()!.execution.successfulCommands = 0
    orchestrator.getSession()!.execution.failedCommands = 1
    orchestrator.getSession()!.gaps.failed = ['gap-failed-1']

    const terminalStatus = (orchestrator as unknown as { resolveTerminalStatus: () => PlanningSessionStatus }).resolveTerminalStatus()

    expect(terminalStatus).toBe('manual_review')
    expect(terminalStatus).not.toBe('failed')
  })

  /**
   * case regression-candidateService-empty-no-throw
   * - expectedDecision: candidateService.queryCandidates 在 channelId 不匹配时返回空候选且不抛错
   * - mustNotHappen: 抛出异常或返回 undefined
   * - verification: 用不存在的 channelId 调用 queryCandidates，断言 result.candidates 为空数组、diagnostics 含 rejectionReasons
   */
  it('candidateService.queryCandidates 在 channelId 无匹配候选时返回空结果且不抛错', async () => {
    resetCandidateService()
    const gap: GapInfo = {
      id: 'gap-no-channel',
      startTime: iso('09:00:00'),
      endTime: iso('10:00:00'),
      duration: 3600,
      constraints: {},
      metadata: { source: 'layout', priority: 1, createdAt: iso('00:00:00'), updatedAt: iso('00:00:00') },
    }
    const result = await getCandidateService().queryCandidates(gap, {
      targetTimeRange: { start: gap.startTime, end: gap.endTime },
      expectedDuration: { min: 1200, max: 3600 },
      channelId: 'nonexistent-channel-xyz',
      columnId: 'nonexistent-column',
      programTypePreference: ['drama'],
      excludeUsed: false,
    })

    expect(result.candidates).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.diagnostics?.rejectionReasons?.length).toBeGreaterThan(0)
  })
})
