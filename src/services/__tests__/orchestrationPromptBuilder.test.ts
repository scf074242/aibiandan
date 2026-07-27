import { describe, expect, it } from 'vitest'

import { buildGapCandidateSelectionPrompt, buildInsertCandidateSelectionPrompt } from '@/services/orchestrationPromptBuilder'
import type { GapInfo, ProgramCandidate, ScheduleItemSnapshot } from '@/types/orchestration'

const date = '2026-03-25'
const iso = (time: string) => `${date}T${time}+08:00`

const gap: GapInfo = {
  id: 'gap-live-carousel',
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

const candidate: ProgramCandidate = {
  id: 'jingan-live',
  programId: 'P-LIVE-JINGAN',
  programCode: 'LIVE-JINGAN-001',
  programName: '看东方：静安寺外场直播 第1期',
  instanceName: '看东方：静安寺外场直播 第1期',
  channelId: 'dragon',
  columnId: '101',
  columnName: '看东方',
  duration: 1800,
  programType: 'news_magazine',
  contentTags: ['静安寺', '外场直播', '直播'],
  estimatedRating: 8.2,
  playCount: 128600,
  popularityScore: 84.7,
  editorialDecision: {
    strategy: 'content_match',
    totalScore: 91.5,
    summary: '内容匹配优先专业判断：标题、栏目和地点均命中。',
    strengths: ['内容命中', '栏目匹配'],
    concerns: [],
    dimensions: [
      { key: 'content_match', score: 98, weight: 0.4, note: '命中静安寺外场直播。' },
      { key: 'rating', score: 82, weight: 0.15, note: '预估收视 8.2。' },
      { key: 'schedule_context', score: 100, weight: 0.1, note: '无冲突。' },
    ],
  },
}

const existingItem: ScheduleItemSnapshot = {
  id: 'existing-0900',
  programCode: '881120030001',
  programName: '品质剧场：纵有疾风起 第1集',
  startTime: iso('09:00:00'),
  endTime: iso('09:45:00'),
  duration: 2700,
  programType: 'drama',
  sequence: 1,
}

describe('orchestrationPromptBuilder', () => {
  it('passes experienced scheduler rules, strategy evidence, and current schedule context into candidate selection prompts', () => {
    const messages = buildGapCandidateSelectionPrompt({
      channelName: '东方卫视',
      date,
      gap,
      candidates: [candidate],
      existingItems: [existingItem],
      planningThought: {
        summary: '静安寺户外直播轮播，内容匹配优先',
        targetProgramTypes: ['news_magazine'],
        targetSlotLabel: '静安寺户外直播',
        durationPreference: { min: 900, max: 3600 },
        searchKeywords: ['静安寺', '外场直播', '直播'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    })

    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('经验丰富的电视节目编排人员')
    expect(prompt).toContain('主优先=content_match')
    expect(prompt).toContain('策略判断口径')
    expect(prompt).toContain('内容匹配优先先看节目标题、所属栏目、节目内容和内容标签')
    expect(prompt).toContain('当前已排节目')
    expect(prompt).toContain('9 点已有第1集时，不应回填 8 点第2集')
    expect(prompt).toContain('editorialStrategy=content_match')
    expect(prompt).toContain('editorialScore=91.5')
    expect(prompt).toContain('estimatedRating=8.2')
    expect(prompt).toContain('playCount=128600')
    expect(prompt).toContain('popularityScore=84.7')
    expect(prompt).toContain('content_match:98/w0.4')
    expect(prompt).toContain('看东方：静安寺外场直播 第1期')
  })

  it('explains trending priority as current topic heat instead of rating statistics', () => {
    const messages = buildGapCandidateSelectionPrompt({
      channelName: '东方卫视',
      date,
      gap,
      candidates: [candidate],
      existingItems: [],
      planningThought: {
        summary: '电视剧轮播单，热播优先',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '电视剧轮播',
        durationPreference: { min: 900, max: 3600 },
        searchKeywords: ['电视剧', '热播'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'trending',
          fallback: ['content_match'],
        },
      },
    })

    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('主优先=trending')
    expect(prompt).toContain('热播优先模拟当前时间点的舆论和话题热度判断')
    expect(prompt).toContain('popularityScore=84.7')
    expect(prompt).not.toContain('收视率优先只以候选的 estimatedRating')
  })

  it('explains rating priority as rating statistics instead of current topic heat', () => {
    const messages = buildGapCandidateSelectionPrompt({
      channelName: '东方卫视',
      date,
      gap,
      candidates: [candidate],
      existingItems: [],
      planningThought: {
        summary: '轮播单，收视率优先',
        targetProgramTypes: ['news_magazine'],
        targetSlotLabel: '午间轮播',
        durationPreference: { min: 900, max: 3600 },
        searchKeywords: ['收视率优先'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
    })

    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('主优先=rating')
    expect(prompt).toContain('收视率优先只以候选的 estimatedRating')
    expect(prompt).not.toContain('热播优先模拟当前时间点的舆论和话题热度判断')
  })
  it('passes possible same-series evidence to the LLM without treating code or title similarity as absolute', () => {
    const messages = buildGapCandidateSelectionPrompt({
      channelName: '东方卫视',
      date,
      gap,
      candidates: [
        {
          id: 'episode-2',
          programId: 'P-DRAMA-JIFENG',
          programCode: '881120030002',
          programName: '品质剧场：纵有疾风起 第2集',
          instanceName: '品质剧场：纵有疾风起 第2集',
          channelId: 'dragon',
          columnId: '112',
          columnName: '品质剧场',
          duration: 2700,
          programType: 'drama',
        },
      ],
      existingItems: [
        {
          id: 'existing-episode-1',
          programCode: '881120030001',
          programName: '品质剧场：纵有疾风起 第1集',
          startTime: iso('09:00:00'),
          endTime: iso('09:45:00'),
          duration: 2700,
          programType: 'drama',
        },
      ],
      planningThought: {
        summary: '品质剧场顺播',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '品质剧场',
        durationPreference: { min: 1200, max: 3600 },
        searchKeywords: ['纵有疾风起'],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: true,
        },
      },
    })

    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('只是判断上下节目的经验线索，不是绝对规则')
    expect(prompt).toContain('seriesEvidence=possible_same_series(name_without_episode+program_code_prefix)')
    expect(prompt).toContain('candidateSequence=2')
    expect(prompt).toContain('existingSequence=1')
  })

  it('passes experienced scheduling guardrails into insert candidate selection prompts', () => {
    const messages = buildInsertCandidateSelectionPrompt(
      {
        scheduleState: {
          channelId: 'dragon',
          channelName: '东方卫视',
          date,
          isEmpty: false,
          itemCount: 1,
          gapCount: 1,
          hasSelectedTimeRange: false,
        },
        userInput: '08:00 插入纵有疾风起第2集',
        currentSchedule: [existingItem],
        scheduleSummary: '09:00:00 已有 品质剧场：纵有疾风起 第1集',
        scheduleNameCandidates: '品质剧场：纵有疾风起 第1集',
        nearbyScheduleSummary: '09:00:00 已有第1集，不应在 08:00 回填第2集',
        targetTimeHints: ['08:00:00'],
      },
      {
        targetTime: '08:00:00',
        programName: '纵有疾风起第2集',
        rawProgramText: '纵有疾风起第2集',
      },
      [
        {
          id: 'episode-2',
          programId: 'P-DRAMA-JIFENG',
          programCode: '881120030002',
          programName: '品质剧场：纵有疾风起 第2集',
          instanceName: '品质剧场：纵有疾风起 第2集',
          channelId: 'dragon',
          columnId: '112',
          columnName: '品质剧场',
          duration: 2700,
          programType: 'drama',
        },
      ],
    )

    const prompt = messages.map((message) => message.content).join('\n')
    expect(prompt).toContain('插入编排判断规则')
    expect(prompt).toContain('none')
    expect(prompt).toContain('clarify')
    expect(prompt).toContain('时间重叠')
    expect(prompt).toContain('顺播倒序')
    expect(prompt).toContain('跳集')
    expect(prompt).toContain('重复集数')
    expect(prompt).toContain('经验线索')
    expect(prompt).toContain('不是绝对规则')
    expect(prompt).toContain('09:00:00 已有 品质剧场：纵有疾风起 第1集')
  })

  /**
   * Q1-1 顺播标准文案统一回归 case：
   * 验证 buildGapCandidateSelectionPrompt 的 system message 包含顺播硬规则核心点 + prompt 版本标注
   */
  it('buildGapCandidateSelectionPrompt 包含顺播标准文案核心点与 prompt 版本标注', () => {
    const messages = buildGapCandidateSelectionPrompt({
      channelName: '东方卫视',
      date,
      gap,
      candidates: [candidate],
      existingItems: [],
      planningThought: {
        summary: '顺播测试',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '品质剧场',
        durationPreference: { min: 900, max: 3600 },
        searchKeywords: ['品质剧场'],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['rating'],
        },
      },
    })

    const prompt = messages.map((message) => message.content).join('\n')
    // 顺播硬规则核心点（来自标准文案）
    expect(prompt).toContain('顺播期数选择是候选决策最高优先级硬规则')
    expect(prompt).toContain('有基线选期望下一集')
    expect(prompt).toContain('无基线选最早一期')
    expect(prompt).toContain('不能跳集、倒序、重复')
    // prompt 版本标注
    expect(prompt).toContain('[prompt v1.0]')
    // sequence 策略文案补「无基线时选最早一期」
    expect(prompt).toContain('无基线时选最早一期')
  })

  /**
   * Q1-1 顺播标准文案统一回归 case：
   * 验证 buildInsertCandidateSelectionPrompt 的 system message 包含顺播硬规则 + prompt 版本标注
   */
  it('buildInsertCandidateSelectionPrompt 包含顺播硬规则核心点与 prompt 版本标注', () => {
    const messages = buildInsertCandidateSelectionPrompt(
      {
        scheduleState: {
          channelName: '东方卫视',
          date,
        },
        scheduleSummary: '当前播单：09:00 品质剧场 第1集',
        nearbyScheduleSummary: '附近：08:00-10:00',
        scheduleNameCandidates: '品质剧场',
        currentSchedule: [existingItem],
      } as never,
      {
        targetTime: '09:00:00',
        programName: '品质剧场',
      } as never,
      [candidate],
    )

    const prompt = messages.map((message) => message.content).join('\n')
    // 顺播硬规则核心点
    expect(prompt).toContain('顺播期数选择是最高优先级硬规则')
    expect(prompt).toContain('有基线选期望下一集')
    expect(prompt).toContain('无基线选最早一期')
    // prompt 版本标注
    expect(prompt).toContain('[prompt v1.0]')
    // 时长优先级声明
    expect(prompt).toContain('顺播硬规则优先于时长考量')
  })
})
