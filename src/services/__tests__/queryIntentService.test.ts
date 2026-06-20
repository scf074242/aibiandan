import { afterEach, describe, expect, it } from 'vitest'

import { QueryIntentService } from '@/services/queryIntentService'
import { clearRuntimeLayout, setRuntimeLayout } from '@/services/orchestration/runtimeLayoutRegistry'
import type { GapInfo, GenerationContext } from '@/types/orchestration'
import type { LLMClient } from '@/services/llm/llmClient'

const date = '2026-03-25'
const iso = (time: string) => `${date}T${time}+08:00`

const createGap = (): GapInfo => ({
  id: 'gap-1',
  startTime: iso('14:00:00'),
  endTime: iso('15:00:00'),
  duration: 3600,
  constraints: {},
  metadata: {
    source: 'layout',
    priority: 50,
    createdAt: iso('00:00:00'),
    updatedAt: iso('00:00:00'),
  },
})

describe('QueryIntentService', () => {
  afterEach(() => {
    clearRuntimeLayout('dragon', date)
  })

  it('passes carousel segment policy but keeps previous-day history out of independent carousel criteria', async () => {
    setRuntimeLayout({
      sourceFileName: 'AI layout draft',
      channelId: 'dragon',
      date,
      warnings: [],
      layoutReference: {
        id: 'layout-runtime',
        name: 'Sequence draft',
        slots: [
          {
            id: 'slot-carousel',
            channelId: 'dragon',
            columnId: 'runtime-column:carousel',
            startTime: iso('14:00:00'),
            endTime: iso('15:00:00'),
          },
        ],
      },
      columns: [
        {
          columnId: 'runtime-column:carousel',
          columnName: 'Sequence theater',
          channelId: 'dragon',
          defaultProgramType: 'drama',
          semanticLabel: 'Sequence theater',
          queryHints: ['电视剧'],
          selectionPolicy: {
            primary: 'rating',
            fallback: ['content_match'],
          },
          source: 'generated',
        },
      ],
    })

    const historyReference = {
      dates: ['2026-03-24'],
      schedules: [
        {
          date: '2026-03-24',
          itemCount: 1,
          programTypes: { drama: 1 },
        },
      ],
    }
    const context: GenerationContext = {
      channel: {
        channelId: 'dragon',
        channelName: 'Dragon TV',
        date,
        timeZone: 'Asia/Shanghai',
        broadcastRules: {
          defaultStartTime: '06:00:00',
          defaultEndTime: '23:59:59',
          minProgramDuration: 60,
          maxProgramDuration: 7200,
          allowedTransitions: {},
        },
      },
      date,
      layoutReference: {
        id: 'layout-runtime',
        name: 'Sequence draft',
        slots: [
          {
            id: 'slot-carousel',
            channelId: 'dragon',
            columnId: 'runtime-column:carousel',
            startTime: iso('14:00:00'),
            endTime: iso('15:00:00'),
          },
        ],
      },
      historyReference,
      constraints: {
        fixedItems: [],
        lockedItems: [],
        blockedTimeRanges: [],
        mandatoryPrograms: [],
      },
    }
    const service = new QueryIntentService({} as LLMClient)

    const criteria = await service.generateCriteria(
      createGap(),
      {
        summary: '轮播单按收视率优先',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 1200, max: 3600 },
        searchKeywords: ['电视剧'],
        allowFiller: false,
        sequentialPreference: false,
      },
      context,
      {
        target: 'test',
        referencePriority: ['layout', 'history', 'library'],
        allowFiller: true,
        sequentialPreference: true,
        riskPreference: 'balanced',
      },
    )

    expect(criteria.columnId).toBe('runtime-column:carousel')
    expect(criteria.selectionPolicy?.primary).toBe('rating')
    expect(criteria.historyReference).toBeUndefined()
  })

  it('passes previous-day history into sequence-first TV channel criteria', async () => {
    setRuntimeLayout({
      sourceFileName: 'AI layout draft',
      channelId: 'dragon',
      date,
      warnings: [],
      layoutReference: {
        id: 'layout-runtime-sequence',
        name: 'Sequence draft',
        slots: [
          {
            id: 'slot-sequence',
            channelId: 'dragon',
            columnId: 'runtime-column:sequence',
            startTime: iso('09:30:00'),
            endTime: iso('10:15:00'),
          },
        ],
      },
      columns: [
        {
          columnId: 'runtime-column:sequence',
          columnName: 'Sequence theater',
          channelId: 'dragon',
          defaultProgramType: 'drama',
          semanticLabel: 'Sequence theater',
          queryHints: ['drama-series'],
          selectionPolicy: {
            primary: 'sequence',
            fallback: ['content_match', 'rating'],
            requiresPreviousSchedule: true,
          },
          source: 'generated',
        },
      ],
    })

    const historyReference = {
      dates: ['2026-03-24'],
      schedules: [
        {
          date: '2026-03-24',
          itemCount: 1,
          programTypes: { drama: 1 },
        },
      ],
    }
    const context: GenerationContext = {
      channel: {
        channelId: 'dragon',
        channelName: 'Dragon TV',
        date,
        timeZone: 'Asia/Shanghai',
        broadcastRules: {
          defaultStartTime: '06:00:00',
          defaultEndTime: '23:59:59',
          minProgramDuration: 60,
          maxProgramDuration: 7200,
          allowedTransitions: {},
        },
      },
      date,
      layoutReference: {
        id: 'layout-runtime-sequence',
        name: 'Sequence draft',
        slots: [
          {
            id: 'slot-sequence',
            channelId: 'dragon',
            columnId: 'runtime-column:sequence',
            startTime: iso('09:30:00'),
            endTime: iso('10:15:00'),
          },
        ],
      },
      historyReference,
      constraints: {
        fixedItems: [],
        lockedItems: [],
        blockedTimeRanges: [],
        mandatoryPrograms: [],
      },
    }
    const service = new QueryIntentService({} as LLMClient)

    const criteria = await service.generateCriteria(
      {
        ...createGap(),
        startTime: iso('09:30:00'),
        endTime: iso('10:15:00'),
        duration: 2700,
      },
      {
        summary: '电视频道顺播',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 2400, max: 3000 },
        searchKeywords: ['drama-series'],
        allowFiller: false,
        sequentialPreference: true,
      },
      context,
      {
        target: 'test',
        referencePriority: ['layout', 'history', 'library'],
        allowFiller: true,
        sequentialPreference: true,
        riskPreference: 'balanced',
      },
    )

    expect(criteria.columnId).toBe('runtime-column:sequence')
    expect(criteria.selectionPolicy?.primary).toBe('sequence')
    expect(criteria.historyReference).toBe(historyReference)
  })

  it('generates scoped search keywords from layout draft constraint kind', async () => {
    const cases = [
      { kind: 'column' as const, expected: '栏目=看东方' },
      { kind: 'program' as const, expected: '节目=看东方' },
      { kind: 'unspecified' as const, expected: '看东方' },
    ]
    const service = new QueryIntentService({} as LLMClient)

    for (const item of cases) {
      setRuntimeLayout({
        sourceFileName: 'AI layout draft',
        channelId: 'dragon',
        date,
        warnings: [],
        layoutReference: {
          id: `layout-runtime-${item.kind}`,
          name: 'Scoped draft',
          slots: [
            {
              id: `slot-${item.kind}`,
              channelId: 'dragon',
              columnId: `runtime-column:${item.kind}`,
              startTime: iso('14:00:00'),
              endTime: iso('15:00:00'),
            },
          ],
        },
        columns: [
          {
            columnId: `runtime-column:${item.kind}`,
            columnName: '看东方',
            channelId: 'dragon',
            defaultProgramType: 'news_magazine',
            semanticLabel: '看东方',
            draftConstraintKind: item.kind,
            source: 'generated',
          },
        ],
      })

      const context: GenerationContext = {
        channel: {
          channelId: 'dragon',
          channelName: 'Dragon TV',
          date,
          timeZone: 'Asia/Shanghai',
          broadcastRules: {
            defaultStartTime: '06:00:00',
            defaultEndTime: '23:59:59',
            minProgramDuration: 60,
            maxProgramDuration: 7200,
            allowedTransitions: {},
          },
        },
        date,
        layoutReference: {
          id: `layout-runtime-${item.kind}`,
          name: 'Scoped draft',
          slots: [
            {
              id: `slot-${item.kind}`,
              channelId: 'dragon',
              columnId: `runtime-column:${item.kind}`,
              startTime: iso('14:00:00'),
              endTime: iso('15:00:00'),
            },
          ],
        },
        constraints: {
          fixedItems: [],
          lockedItems: [],
          blockedTimeRanges: [],
          mandatoryPrograms: [],
        },
      }

      const criteria = await service.generateCriteria(
        createGap(),
        {
          summary: '按版面检索',
          targetProgramTypes: [],
          durationPreference: { min: 1200, max: 3600 },
          searchKeywords: ['用户补充'],
          allowFiller: false,
          sequentialPreference: false,
        },
        context,
        {
          target: 'test',
          referencePriority: ['layout', 'history', 'library'],
          allowFiller: true,
          sequentialPreference: false,
          riskPreference: 'balanced',
        },
      )

      expect(criteria.searchKeywords).toEqual([item.expected, '用户补充'])
    }
  })
})
