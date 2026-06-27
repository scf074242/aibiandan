import { describe, expect, it, vi } from 'vitest'

import { CandidateSelectionService } from '@/services/candidateSelectionService'
import type { LLMClient } from '@/services/llm/llmClient'
import type { GapInfo, ProgramCandidate } from '@/types/orchestration'

const baseDate = '2026-03-25'
const iso = (time: string) => `${baseDate}T${time}+08:00`

const createGap = (): GapInfo => ({
  id: 'gap-1',
  startTime: iso('12:45:00'),
  endTime: iso('13:00:00'),
  duration: 900,
  constraints: {},
  metadata: {
    source: 'generated',
    priority: 1,
    createdAt: iso('00:00:00'),
    updatedAt: iso('00:00:00'),
  },
})

const createCandidate = (overrides: Partial<ProgramCandidate> = {}): ProgramCandidate => ({
  id: 'candidate-1',
  programId: 'P113001',
  programCode: '002601130001',
  programName: '经典剧场：烟火人家 第1集',
  instanceName: '经典剧场：烟火人家 第1集',
  channelId: 'dragon',
  duration: 900,
  programType: 'drama',
  issueNo: '0001',
  ...overrides,
})

describe('CandidateSelectionService', () => {
  it('allows the LLM to reject all candidates when a hard requirement is missing', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'none',
          selectedCandidateId: null,
          confidence: 0.95,
          reasoning: '用户明确要求“生命树”，候选均未命中该标题，不能用其他电视剧替代。',
          matchedRequirements: ['programType: drama'],
          missingRequirements: ['title: 生命树'],
          riskFlags: ['明确标题未命中'],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate(),
        createCandidate({
          id: 'candidate-2',
          programCode: '002601120001',
          programName: '品质剧场：纵有疾风起 第1集',
          instanceName: '品质剧场：纵有疾风起 第1集',
        }),
      ],
      {
        summary: '12:45-13:00 编排生命树电视剧',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '生命树电视剧',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['生命树电视剧'],
        allowFiller: false,
        sequentialPreference: true,
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('title: 生命树')
  })

  it('uses deterministic editor fallback when LLM abstains but content-match candidates satisfy hard requirements', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'none',
          selectedCandidateId: null,
          confidence: 0.62,
          reasoning: 'The model is unsure and declines to pick one.',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      'dragon',
      baseDate,
      [
        createCandidate({
          id: 'generic-news',
          programName: 'City Update',
          instanceName: 'City Update',
          programType: 'news_magazine',
          contentTags: ['city'],
        }),
        createCandidate({
          id: 'live-guide',
          programName: 'Live Guide Briefing',
          instanceName: 'Live Guide Briefing',
          programType: 'news_magazine',
          contentTags: ['Guide', 'Live'],
        }),
      ],
      {
        summary: '14:00-14:30 prepare a live guide briefing',
        targetProgramTypes: ['news_magazine'],
        targetSlotLabel: 'Live Guide',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['Live Guide'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('live-guide')
    expect(result.matchedRequirements).toContain('strategy_guard:llm_abstention_fallback')
    expect(result.riskFlags).toContain('llm_abstention_overridden_by_local_strategy')
  })

  it('blocks an LLM-selected candidate when structured column evidence only appears in the wrong field', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'wrong-field-column',
          confidence: 0.91,
          reasoning: '标题和标签里有看东方与静安寺。',
          matchedRequirements: ['content: 静安寺'],
          missingRequirements: [],
          riskFlags: [],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'wrong-field-column',
          programName: '看东方：静安寺外场直播 第1期',
          instanceName: '看东方：静安寺外场直播 第1期',
          programType: 'news_magazine',
          columnName: 'ShanghaiEye',
          contentTags: ['看东方', '静安寺', '外场直播'],
        }),
      ],
      {
        summary: '14:00-15:00 安排所属栏目看东方、节目内容静安寺的轮播单',
        targetProgramTypes: ['news_magazine'],
        targetSlotLabel: '看东方静安寺轮播',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['所属栏目看东方', '节目内容静安寺'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('hard_keywords')
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })

  it('returns the selected candidate with professional reasoning when LLM selects one', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'candidate-2',
          confidence: 0.92,
          reasoning: '标题和集数均命中，适合排入。',
          matchedRequirements: ['title: 归路', 'episode: 1', 'programType: drama'],
          missingRequirements: [],
          riskFlags: [],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const selected = createCandidate({
      id: 'candidate-2',
      programId: 'P124001',
      programCode: '002601240001',
      programName: '梦想剧场：归路 第1集',
      instanceName: '梦想剧场：归路 第1集',
      issueNo: '0001',
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [createCandidate(), selected],
      {
        summary: '12:45-13:00 编排梦醒剧场：归路 第1集',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '梦醒剧场：归路 第1集',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['梦醒剧场：归路 第1集'],
        allowFiller: false,
        sequentialPreference: true,
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('candidate-2')
    expect(result.matchedRequirements).toContain('title: 归路')
  })

  it('blocks an LLM-selected candidate when the title matches but explicit episode is wrong', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'episode-6',
          confidence: 0.91,
          reasoning: '标题命中，模型误选了第6集。',
          matchedRequirements: ['title: 纵有疾风起'],
          missingRequirements: [],
          riskFlags: [],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'episode-6',
          programCode: '881120030006',
          programName: '品质剧场：纵有疾风起 第6集',
          instanceName: '品质剧场：纵有疾风起 第6集',
          issueNo: '0006',
        }),
      ],
      {
        summary: '12:45-13:00 编排纵有疾风起第5集',
        targetProgramTypes: ['drama'],
        targetSlotLabel: '纵有疾风起第5集',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['纵有疾风起 第5集'],
        allowFiller: false,
        sequentialPreference: false,
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('hard_keywords')
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })

  it('blocks an LLM-selected candidate when only the topic matches but the requested utility does not', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'topic-only',
          confidence: 0.9,
          reasoning: '模型只看到了发布会主题，但忽略了导视功能。',
          matchedRequirements: ['topic: 发布会'],
          missingRequirements: [],
          riskFlags: [],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'topic-only',
          programCode: 'EVENT-TOPIC-ONLY',
          programName: '城市论坛发布会精编 第1期',
          instanceName: '城市论坛发布会精编 第1期',
          duration: 900,
          programType: 'news_magazine',
          contentTags: ['发布会'],
        }),
        createCandidate({
          id: 'topic-and-function',
          programCode: 'EVENT-TOPIC-FUNCTION',
          programName: '发布会预热导视 第1期',
          instanceName: '发布会预热导视 第1期',
          duration: 900,
          programType: 'news_magazine',
          contentTags: ['发布会', '预热', '导视'],
        }),
      ],
      {
        summary: '发布会开播前垫一点现场导视',
        targetProgramTypes: ['news_magazine', 'news'],
        targetSlotLabel: '发布会现场导视',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['发布会现场导视'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('hard_keywords')
    expect(result.reasoning).toContain('功能型内容要求')
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })

  it('blocks an LLM-selected candidate when it misses an explicit column requirement', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'content-only',
          confidence: 0.9,
          reasoning: '模型只看到了静安寺内容，但忽略所属栏目要求。',
          matchedRequirements: ['content: 静安寺'],
          missingRequirements: [],
          riskFlags: [],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'content-only',
          programCode: 'JINGAN-ONLY',
          programName: '静安寺外场直播 第1期',
          instanceName: '静安寺外场直播 第1期',
          duration: 900,
          programType: 'news_magazine',
          columnName: 'ShanghaiEye',
          columnId: '104',
          contentTags: ['静安寺', '外场直播'],
        }),
        createCandidate({
          id: 'column-and-content',
          programCode: 'KANDF-JINGAN',
          programName: '看东方：静安寺外场直播 第1期',
          instanceName: '看东方：静安寺外场直播 第1期',
          duration: 900,
          programType: 'news_magazine',
          columnName: '看东方',
          columnId: '101',
          contentTags: ['看东方', '静安寺', '外场直播'],
        }),
      ],
      {
        summary: '所属栏目看东方，节目内容静安寺',
        targetProgramTypes: ['news_magazine', 'news'],
        targetSlotLabel: '看东方静安寺内容',
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['所属栏目看东方', '节目内容静安寺'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('hard_keywords')
    expect(result.riskFlags).toContain('llm_selection_blocked')
  })

  it('falls back to rating priority when the segment policy requests rating first', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const lowRating = createCandidate({
      id: 'low-rating',
      programCode: 'rating-low',
      estimatedRating: 6.1,
    })
    const highRating = createCandidate({
      id: 'high-rating',
      programCode: 'rating-high',
      estimatedRating: 8.9,
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [lowRating, highRating],
      {
        summary: '轮播单按收视率优先',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['电视剧'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('high-rating')
    expect(result.reasoning).toContain('收视率优先')
  })

  it('falls back to trending priority when the segment policy requests currently hot programs first', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const highRatingLowTrend = createCandidate({
      id: 'high-rating-low-trend',
      programCode: 'trend-low',
      estimatedRating: 9.2,
      popularityScore: 52,
      contentTags: ['电视剧', '经典'],
    })
    const lowerRatingHotTopic = createCandidate({
      id: 'lower-rating-hot-topic',
      programCode: 'trend-high',
      estimatedRating: 7.1,
      popularityScore: 93,
      contentTags: ['电视剧', '热播', '话题'],
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [highRatingLowTrend, lowerRatingHotTopic],
      {
        summary: '轮播单按热播优先',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'trending',
          fallback: ['content_match'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('lower-rating-hot-topic')
    expect(result.reasoning).toContain('热播优先')
  })

  it('continues with local trending strategy when the LLM abstains but hot candidates satisfy hard constraints', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'none',
          selectedCandidateId: null,
          confidence: 0.58,
          reasoning: 'LLM is unsure about current topic heat.',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const lowTrend = createCandidate({
      id: 'low-trend',
      programCode: 'trend-abstain-low',
      estimatedRating: 8.9,
      popularityScore: 48,
      contentTags: ['电视剧'],
    })
    const highTrend = createCandidate({
      id: 'high-trend',
      programCode: 'trend-abstain-high',
      estimatedRating: 7.1,
      popularityScore: 94,
      contentTags: ['电视剧', '热播', '话题'],
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [lowTrend, highTrend],
      {
        summary: '轮播单按热播优先',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'trending',
          fallback: ['content_match'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('high-trend')
    expect(result.reasoning).toContain('热播优先')
    expect(result.matchedRequirements).toContain('strategy_guard:llm_abstention_fallback')
    expect(result.riskFlags).toContain('llm_abstention_overridden_by_local_strategy')
  })

  it('falls back to content match before duration fit when the segment policy requests content first', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const exactDurationButLooseContent = createCandidate({
      id: 'exact-duration-loose-content',
      programName: 'Weather Bulletin',
      instanceName: 'Weather Bulletin',
      duration: 900,
      programType: 'news',
    })
    const contentMatchedButLonger = createCandidate({
      id: 'content-matched-longer',
      programName: 'City News Special',
      instanceName: 'City News Special',
      duration: 420,
      programType: 'news',
    })

    const result = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      [exactDurationButLooseContent, contentMatchedButLonger],
      {
        summary: '轮播单内容匹配优先，优先安排新闻相关内容',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: ['news'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('content-matched-longer')
  })

  it('uses different deterministic choices for the same carousel candidates under rating and content priorities', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const highRatingLooseContent = createCandidate({
      id: 'high-rating-loose-content',
      programName: 'Market Report',
      instanceName: 'Market Report',
      programType: 'news',
      estimatedRating: 9.2,
    })
    const lowerRatingContentMatched = createCandidate({
      id: 'lower-rating-content-matched',
      programName: 'City News News Special',
      instanceName: 'City News News Special',
      programType: 'news',
      contentTags: ['news', 'city'],
      estimatedRating: 6.4,
    })
    const candidates = [highRatingLooseContent, lowerRatingContentMatched]

    const ratingResult = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      candidates,
      {
        summary: 'carousel rating first',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: ['news'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
    )
    const contentResult = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      candidates,
      {
        summary: 'carousel content first',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: ['news'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(ratingResult.decision).toBe('select')
    expect(ratingResult.selectedCandidate?.id).toBe('high-rating-loose-content')
    expect(contentResult.decision).toBe('select')
    expect(contentResult.selectedCandidate?.id).toBe('lower-rating-content-matched')
    expect(contentResult.reasoning).toContain('内容匹配优先')
  })

  it('blocks an LLM-selected candidate when professional content evidence is too weak for auto scheduling', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'weak-static-only',
          confidence: 0.91,
          reasoning: '候选提到了静安寺，因此选择它。',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'weak-static-only',
          programName: '城市服务：静安寺周边提示',
          instanceName: '城市服务：静安寺周边提示',
          programType: 'news_magazine',
          contentTags: ['静安寺'],
        }),
      ],
      {
        summary: '14:00-15:00 静安寺户外直播轮播单，内容匹配优先',
        targetProgramTypes: ['news_magazine'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['静安寺', '户外直播'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.matchedRequirements).toContain('content_intent:静安寺')
    expect(result.missingRequirements).toContain('editorial_quality')
    expect(result.missingRequirements).toContain('content_intent:户外')
    expect(result.missingRequirements).toContain('content_intent:直播')
    expect(result.riskFlags).toContain('editorial_auto_select_threshold_blocked')
    expect(result.reasoning).toContain('专业匹配证据不足')
  })

  it('keeps the gap empty when fallback candidates only weakly match a concrete content intent', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'weak-static-only',
          programName: '城市服务：静安寺周边提示',
          instanceName: '城市服务：静安寺周边提示',
          programType: 'news_magazine',
          contentTags: ['静安寺'],
        }),
      ],
      {
        summary: '14:00-15:00 静安寺户外直播轮播单，内容匹配优先',
        targetProgramTypes: ['news_magazine'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['静安寺', '户外直播'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('editorial_quality')
    expect(result.riskFlags).toContain('editorial_auto_select_threshold_blocked')
  })

  it('overrides an LLM choice that violates carousel rating priority', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'low-rating',
          confidence: 0.95,
          reasoning: 'LLM accidentally picked the lower-rating candidate.',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const lowRating = createCandidate({
      id: 'low-rating',
      programName: 'Daily News',
      instanceName: 'Daily News',
      programType: 'news',
      estimatedRating: 5.8,
    })
    const highRating = createCandidate({
      id: 'high-rating',
      programName: 'Market Report',
      instanceName: 'Market Report',
      programType: 'news',
      estimatedRating: 9.1,
    })

    const result = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      [lowRating, highRating],
      {
        summary: 'carousel rating first',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'rating',
          fallback: ['content_match'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('high-rating')
    expect(result.matchedRequirements).toContain('strategy_guard:rating_priority')
    expect(result.riskFlags).toContain('llm_selection_strategy_overridden')
  })

  it('overrides an LLM choice that violates carousel trending priority', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'low-trend',
          confidence: 0.95,
          reasoning: 'LLM picked the lower-trend candidate.',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const lowTrend = createCandidate({
      id: 'low-trend',
      programName: 'Classic Drama',
      instanceName: 'Classic Drama',
      programType: 'drama',
      estimatedRating: 9.2,
      popularityScore: 50,
      contentTags: ['电视剧'],
    })
    const highTrend = createCandidate({
      id: 'high-trend',
      programName: 'Hot Topic Drama',
      instanceName: 'Hot Topic Drama',
      programType: 'drama',
      estimatedRating: 7.3,
      popularityScore: 95,
      contentTags: ['电视剧', '热播', '话题'],
    })

    const result = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      [lowTrend, highTrend],
      {
        summary: 'carousel trending first',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'trending',
          fallback: ['content_match'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('high-trend')
    expect(result.matchedRequirements).toContain('strategy_guard:trending_priority')
    expect(result.riskFlags).toContain('llm_selection_strategy_overridden')
  })

  it('does not let trending priority override existing schedule conflicts', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'hot-conflicting',
          confidence: 0.96,
          reasoning: 'LLM picked the hottest candidate without considering the existing schedule.',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const hotConflicting = createCandidate({
      id: 'hot-conflicting',
      programCode: 'HOT-CONFLICT-001',
      programName: '热播剧场：城市话题 第2集',
      instanceName: '热播剧场：城市话题 第2集',
      programType: 'drama',
      popularityScore: 98,
      contentTags: ['电视剧', '热播', '话题'],
    })

    const result = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      [hotConflicting],
      {
        summary: 'carousel trending first',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'trending',
          fallback: ['content_match'],
        },
      },
      {
        existingItems: [
          {
            id: 'existing-overlap',
            programCode: 'EXISTING-001',
            programName: '已有节目',
            startTime: iso('12:50:00'),
            endTime: iso('13:10:00'),
            duration: 1200,
            programType: 'news',
          },
        ],
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.missingRequirements).toContain('schedule_context')
    expect(result.riskFlags).toContain('schedule_context_conflict')
  })

  it('blocks an LLM-selected later episode when backfilling before an existing earlier episode', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'episode-2',
          confidence: 0.96,
          reasoning: 'LLM 只按顺播下一集选择了第2集，但忽略了当前节目单里9点已有第1集。',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      {
        ...createGap(),
        id: 'gap-0800',
        startTime: iso('08:00:00'),
        endTime: iso('08:45:00'),
        duration: 2700,
      },
      '东方卫视',
      baseDate,
      [
        createCandidate({
          id: 'episode-2',
          programCode: '881120030002',
          programName: '品质剧场：纵有疾风起 第2集',
          instanceName: '品质剧场：纵有疾风起 第2集',
          issueNo: '0002',
          duration: 2700,
        }),
      ],
      {
        summary: '08:00-08:45 顺播品质剧场：纵有疾风起',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 2700 },
        searchKeywords: ['纵有疾风起'],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match'],
          requiresPreviousSchedule: true,
        },
      },
      {
        existingItems: [
          {
            id: 'existing-0900-episode-1',
            programCode: '881120030001',
            programName: '品质剧场：纵有疾风起 第1集',
            startTime: iso('09:00:00'),
            endTime: iso('09:45:00'),
            duration: 2700,
            programType: 'drama',
            sequence: 1,
          },
        ],
      },
    )

    expect(result.decision).toBe('none')
    expect(result.selectedCandidate).toBeUndefined()
    expect(result.reasoning).toContain('顺播倒序')
    expect(result.missingRequirements).toContain('schedule_context')
    expect(result.riskFlags).toContain('schedule_context_conflict')
  })

  it('overrides an LLM choice that violates carousel content-match priority', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'loose-content',
          confidence: 0.95,
          reasoning: 'LLM picked the looser content candidate.',
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const looseContent = createCandidate({
      id: 'loose-content',
      programName: 'Daily News',
      instanceName: 'Daily News',
      programType: 'news',
      estimatedRating: 9.2,
    })
    const betterContent = createCandidate({
      id: 'better-content',
      programName: 'City News News Special',
      instanceName: 'City News News Special',
      programType: 'news',
      contentTags: ['news', 'city'],
      estimatedRating: 6.4,
    })

    const result = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      [looseContent, betterContent],
      {
        summary: 'carousel content first',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: ['news'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('better-content')
    expect(result.matchedRequirements).toContain('strategy_guard:content_match_priority')
    expect(result.riskFlags).toContain('llm_selection_strategy_overridden')
  })

  it('includes editorial decision summary in deterministic fallback reasoning', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const candidate = createCandidate({
      id: 'editorial-candidate',
      editorialDecision: {
        strategy: 'content_match',
        totalScore: 88,
        summary: 'editorial-summary: content wins',
        strengths: ['content'],
        concerns: [],
        dimensions: [
          { key: 'content_match', score: 95, weight: 0.4, note: 'matched' },
        ],
      },
    })

    const result = await service.selectForGap(
      createGap(),
      'Dragon TV',
      baseDate,
      [candidate],
      {
        summary: 'content first',
        targetProgramTypes: ['news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.reasoning).toContain('editorial-summary: content wins')
  })

  it('generates a professional editorial scorecard when candidates do not provide one', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const candidate = createCandidate({
      id: 'generated-editorial-card',
      programName: '城市服务：静安寺户外直播导视',
      instanceName: '城市服务：静安寺户外直播导视',
      programType: 'news_magazine',
      contentTags: ['静安寺', '户外直播', '导视'],
      estimatedRating: 7.6,
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [candidate],
      {
        summary: '静安寺户外直播轮播，内容匹配优先',
        targetProgramTypes: ['news_magazine'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['静安寺', '户外直播', '导视'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.editorialDecision?.strategy).toBe('content_match')
    expect(result.editorialDecision?.summary).toContain('专业判断')
    expect(result.editorialDecision?.dimensions.map((item) => item.key)).toEqual([
      'content_match',
      'duration_fit',
      'rating',
      'trend',
      'sequence',
      'type_fit',
      'schedule_context',
    ])
    expect(result.editorialDecision?.dimensions.find((item) => item.key === 'content_match')?.score).toBeGreaterThanOrEqual(80)
    expect(result.matchedRequirements).toEqual(
      expect.arrayContaining(['editorial_strategy:content_match']),
    )
  })

  it('preserves professional editorial dimensions when the LLM selects a candidate', async () => {
    const llmClient = {
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          decision: 'select',
          selectedCandidateId: 'editorial-llm-candidate',
          confidence: 0.93,
          reasoning: '内容主题、时长和当前时段都适合排入。',
          matchedRequirements: ['content: city service'],
          missingRequirements: [],
          riskFlags: [],
        }),
      })),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const candidate = createCandidate({
      id: 'editorial-llm-candidate',
      programName: '城市服务：静安寺户外直播导视',
      instanceName: '城市服务：静安寺户外直播导视',
      programType: 'news_magazine',
      editorialDecision: {
        strategy: 'content_match',
        totalScore: 91.5,
        summary: '专业判断：内容匹配强，适合当前轮播段。',
        strengths: ['内容关键词命中', '时长承接稳定'],
        concerns: [],
        dimensions: [
          { key: 'content_match', score: 96, weight: 0.4, note: '命中静安寺和户外直播。' },
          { key: 'duration_fit', score: 90, weight: 0.2, note: '可放入当前空窗。' },
          { key: 'schedule_context', score: 100, weight: 0.1, note: '无冲突。' },
        ],
      },
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [candidate],
      {
        summary: '静安寺户外直播轮播，内容匹配优先',
        targetProgramTypes: ['news_magazine'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: ['静安寺', '户外直播'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.editorialDecision?.strategy).toBe('content_match')
    expect(result.editorialDecision?.dimensions.map((item) => item.key)).toEqual(
      expect.arrayContaining(['content_match', 'duration_fit', 'schedule_context']),
    )
    expect(result.reasoning).toContain('专业判断：内容匹配强')
    expect(result.matchedRequirements).toEqual(
      expect.arrayContaining(['content: city service', 'editorial_strategy:content_match', 'editorial_score:91.5']),
    )
  })

  it('uses functional keywords when falling back for editorial utility segments', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const genericNews = createCandidate({
      id: 'generic-news',
      programName: '东方新闻',
      instanceName: '东方新闻',
      programType: 'news',
      duration: 900,
    })
    const guide = createCandidate({
      id: 'guide',
      programName: '城市活动预热导视 第1期',
      instanceName: '城市活动预热导视 第1期',
      programType: 'news_magazine',
      duration: 600,
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [genericNews, guide],
      {
        summary: '现场导视',
        targetProgramTypes: ['news_magazine', 'news'],
        durationPreference: { min: 60, max: 1800 },
        searchKeywords: ['现场导视'],
        allowFiller: false,
        sequentialPreference: false,
        selectionPolicy: {
          primary: 'content_match',
          fallback: ['rating'],
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('guide')
  })

  it('keeps sequential candidate order when the segment policy requests sequence first', async () => {
    const llmClient = {
      chat: vi.fn(async () => {
        throw new Error('LLM unavailable')
      }),
    } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)
    const nextEpisode = createCandidate({
      id: 'episode-5',
      programCode: '881120030005',
      programName: '品质剧场：纵有疾风起 第5集',
      instanceName: '品质剧场：纵有疾风起 第5集',
      issueNo: '0005',
    })
    const earlierEpisode = createCandidate({
      id: 'episode-1',
      programCode: '881120030001',
      programName: '品质剧场：纵有疾风起 第1集',
      instanceName: '品质剧场：纵有疾风起 第1集',
      issueNo: '0001',
    })

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [nextEpisode, earlierEpisode],
      {
        summary: '电视频道顺播，参考昨日进度',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match', 'rating'],
          requiresPreviousSchedule: true,
        },
      },
    )

    expect(result.decision).toBe('select')
    expect(result.selectedCandidate?.id).toBe('episode-5')
    expect(result.reasoning).toContain('顺播策略')
  })

  it('passes existing schedule context into the LLM selection prompt', async () => {
    const chat = vi.fn(async () => ({
      content: JSON.stringify({
        decision: 'select',
        selectedCandidateId: 'candidate-1',
        confidence: 0.88,
        reasoning: '已结合当前已排节目确认不冲突。',
      }),
    }))
    const llmClient = { chat } as unknown as LLMClient
    const service = new CandidateSelectionService(llmClient)

    const result = await service.selectForGap(
      createGap(),
      '东方卫视',
      baseDate,
      [createCandidate({
        columnName: '看东方',
        columnId: '101',
        contentTags: ['看东方', '城市服务', '静安寺'],
      })],
      {
        summary: '回填 8 点空窗',
        targetProgramTypes: ['drama'],
        durationPreference: { min: 60, max: 900 },
        searchKeywords: [],
        allowFiller: false,
        sequentialPreference: true,
        selectionPolicy: {
          primary: 'sequence',
          fallback: ['content_match'],
          requiresPreviousSchedule: true,
        },
      },
      {
        existingItems: [
          {
            id: 'existing-0900',
            programCode: '881120030001',
            programName: '品质剧场：纵有疾风起 第1集',
            startTime: iso('09:00:00'),
            endTime: iso('09:45:00'),
            duration: 2700,
            programType: 'drama',
            sequence: 1,
          },
        ],
      },
    )

    const messages = chat.mock.calls[0]?.[0] as Array<{ role: string; content: string }>
    const prompt = messages.map((message) => message.content).join('\n')
    expect(result.decision).toBe('select')
    expect(prompt).toContain('当前已排节目')
    expect(prompt).toContain('column=看东方')
    expect(prompt).toContain('tags=看东方|城市服务|静安寺')
    expect(prompt).toContain('品质剧场：纵有疾风起 第1集')
    expect(prompt).toContain('09:00:00')
    expect(prompt).toContain('不应回填 8 点第2集')
  })
})
