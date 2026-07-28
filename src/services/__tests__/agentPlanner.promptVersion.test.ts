import { describe, expect, it, vi } from 'vitest'

import { AgentPlanner, AGENT_PLANNER_PROMPT_VERSION } from '@/services/llm/agentPlanner'

describe('AgentPlanner promptVersion 透传', () => {
  /**
   * case c7-agent-planner-passes-version
   * - expectedDecision: plan 调用 LLM 时透传 promptVersion
   * - mustNotHappen: options 缺失 promptVersion
   * - verification: chat.mock.calls[0][1] 含当前 AGENT_PLANNER_PROMPT_VERSION
   */
  it('c7-agent-planner-passes-version: plan 透传 promptVersion', async () => {
    const chat = vi.fn(async () => ({
      content: '{"mode":"single","actions":[],"assistantReplyDraft":"测试","reasoning":"测试"}',
    }))
    const planner = new AgentPlanner({ chat } as never)

    await planner.plan({
      scheduleState: {
        channelId: 'dragon',
        channelName: '东方卫视',
        date: '2026-03-25',
        playlistType: 'none',
        isEmpty: true,
        itemCount: 0,
        gapCount: 0,
        hasSelectedTimeRange: false,
      },
      userInput: '帮我排个节目',
      currentSchedule: [],
    })

    expect(chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        promptVersion: AGENT_PLANNER_PROMPT_VERSION,
        traceLabel: 'agent_planner',
      }),
    )
  })
  it('agent-planner-formal-react-contract-v1-8: declares executable formal ReAct and pending action contracts', async () => {
    const testCase = {
      id: 'agent-planner-formal-react-contract-v1-8',
      userInput: '补齐当前播单全部空窗',
      expectedDecision: 'prompt 要求 formal_orchestration 同时提供 reactTask，atomic pending 明确提供 pendingAction',
      mustNotHappen: '本地生成第一步、atomic action 缺少 mutationPolicy，或本地猜测确认语义',
      verification: 'system prompt 包含可观察首批、显式 mutationPolicy 与 pendingAction 约束',
    }
    let systemPrompt = ''
    const planner = new AgentPlanner({
      chat: vi.fn(async (messages) => {
        systemPrompt = messages[0]?.content ?? ''
        return { content: '{"mode":"single","actions":[]}' }
      }),
    } as never)

    await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: false, itemCount: 1, gapCount: 1, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(AGENT_PLANNER_PROMPT_VERSION).toBe('v1.11')
    expect(systemPrompt).toContain('formal_orchestration 是长流程控制动作')
    expect(systemPrompt).toContain('research_check、validate')
    expect(systemPrompt).toContain('mutationPolicy')
    expect(systemPrompt).toContain('pendingAction')
    expect(systemPrompt).toContain('不要返回 queries:[]')
    expect(systemPrompt).toContain('本地不会从')
  })

  it('agent-planner-v1-11: separates finite batch edits from overall orchestration', async () => {
    const testCase = {
      id: 'post9-hybrid-finite-batch-remains-composite-atomic',
      userInput: '把今天所有看东方删掉，再把东方剧场整体后移半小时',
      expectedDecision: '有限目标集合走复合原子命令，覆盖整表或全部空窗才走 formal_orchestration',
      mustNotHappen: '因草案不完整把有限批量操作升级为草案完善或整体编排',
      verification: 'system prompt 含有限目标、整体覆盖和草案门禁三段边界',
    }
    let systemPrompt = ''
    const planner = new AgentPlanner({
      chat: vi.fn(async (messages) => {
        systemPrompt = messages[0]?.content ?? ''
        return { content: JSON.stringify({
          mode: 'react', actions: [],
          reactTask: {
            objective: '分批删除并移动明确目标节目', maxTurns: 4, batchSize: 5,
            stopCondition: '全部明确目标完成或暴露失败',
            nextActions: [{ type: 'validate' }],
          },
        }) }
      }),
    } as never)

    await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: false, itemCount: 12, gapCount: 2, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(systemPrompt).toContain('有限、可定位的目标集合')
    expect(systemPrompt).toContain('整张播单、全部空窗或完整目标时长')
    expect(systemPrompt).toContain('不能因为草案缺失或不完整')
  })

  it('agent-planner-draft-formal-owner-v1-8: exposes pending ownership and requires clarification on owner ambiguity', async () => {
    const testCase = {
      id: 'agent-planner-draft-formal-owner-v1-8',
      userInput: '把第二段删掉',
      expectedDecision: '模型能看到 pending owner；草案和正式播单目标不明确时返回 clarify',
      mustNotHappen: '默认删除草案段、默认删除正式节目或复用另一 owner 的 pending 槽位',
      verification: 'system prompt 含 owner 切换与歧义规则，user prompt 含结构化 pending owner',
    }
    let systemPrompt = ''
    let userPrompt = ''
    const planner = new AgentPlanner({
      chat: vi.fn(async (messages) => {
        systemPrompt = messages[0]?.content ?? ''
        userPrompt = messages[1]?.content ?? ''
        return { content: '{"actions":[{"type":"clarify","question":"你是要删除草案第二段，还是正式播单第二条节目？"}]}' }
      }),
    } as never)

    const plan = await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: false, itemCount: 2, gapCount: 0, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
      contextPackage: {
        scenario: 'atomic',
        workspace: { workspaceKey: 'tv:playlist-a:2026-07-18', playlistType: 'tv', channelName: '东方卫视', date: '2026-07-18', itemCount: 2, gapCount: 0, scheduleSummary: [] },
        layoutDraft: { available: true, referencedByCurrentTask: false, completeness: { status: 'complete' } },
        review: {
          kind: 'parameter_clarification', owner: 'formal_playlist', phase: 'clarifying', pendingId: 'pending-delete',
          action: 'delete', summary: '待补充正式删除目标', riskLevel: 'high',
          allowedResponses: ['clarify', 'cancel'], expiresOnNextNonAnswer: false,
        },
        pending: {
          owner: 'formal_playlist', phase: 'clarifying', pendingId: 'pending-delete', action: 'delete',
          summary: '待补充正式删除目标', missingFields: ['target_time'],
        },
        reactTask: { active: false },
        allowedActions: ['insert', 'delete', 'move', 'replace'],
      } as never,
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(systemPrompt).toContain('pending.owner')
    expect(systemPrompt).toContain('layout_draft')
    expect(systemPrompt).toContain('formal_playlist')
    expect(systemPrompt).toContain('返回 clarify 追问目标对象')
    expect(JSON.parse(userPrompt).foregroundContext).toMatchObject({
      pending: { owner: 'formal_playlist', phase: 'clarifying', pendingId: 'pending-delete' },
    })
    expect(plan.actions[0]).toMatchObject({ type: 'clarify' })
  })

  it('agent-planner-tv-atomic-ignores-draft-completeness-v1-8: keeps incomplete-draft inserts on the atomic path', async () => {
    const testCase = {
      id: 'agent-planner-tv-atomic-ignores-draft-completeness-v1-8',
      userInput: '插入一个节目',
      expectedDecision: '保持 formal_playlist atomic_command，并追问缺少的时间或节目',
      mustNotHappen: '因草案为空或不完整而生成、修改、提交草案或启动整体编排',
      verification: '电视播单 prompt 明确草案完整度与原子命令解耦，并禁止升级成长流程',
    }
    let systemPrompt = ''
    const planner = new AgentPlanner({
      chat: vi.fn(async (messages) => {
        systemPrompt = messages[0]?.content ?? ''
        return {
          content: JSON.stringify({
            actions: [{ type: 'atomic_command', intent: 'insert' }],
            assistantReplyDraft: '请补充要插入的节目和时间。',
            reasoning: '用户明确要修改正式播单，但原子槽位不足。',
          }),
        }
      }),
    } as never)

    const plan = await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: true, itemCount: 0, gapCount: 1, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(systemPrompt).toContain('草案完整度无关')
    expect(systemPrompt).toContain('保持 atomic_command')
    expect(systemPrompt).toContain('原子补参/候选澄清')
    expect(systemPrompt).toContain('不能改成 refine_layout_draft、commit_layout_draft 或 formal_orchestration')
    expect(plan.actions[0]).toMatchObject({ type: 'atomic_command', intent: 'insert' })
  })

  it('agent-planner-formal-rebuild-review-v1-5: injects the exact pending rebuild contract', async () => {
    const testCase = {
      id: 'agent-planner-formal-rebuild-review-v1-5',
      userInput: '确认重新编排',
      expectedDecision: 'LLM 收到当前 formal rebuild 的 actionKind、mode、useLayoutDraft，并被要求显式确认',
      mustNotHappen: '上下文只给模糊摘要，导致模型再次生成未确认的重编请求或切到旧执行路径',
      verification: 'user prompt 包含 review.formalRebuild，system prompt 包含 confirmExistingRebuild:true 契约',
    }
    let systemPrompt = ''
    let userPrompt = ''
    const planner = new AgentPlanner({
      chat: vi.fn(async (messages) => {
        systemPrompt = messages[0]?.content ?? ''
        userPrompt = messages[1]?.content ?? ''
        return { content: '{"mode":"single","actions":[]}' }
      }),
    } as never)

    await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: false, itemCount: 52, gapCount: 5, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
      contextPackage: {
        scenario: 'review',
        workspace: { playlistType: 'tv', channelName: '东方卫视', date: '2026-07-18', itemCount: 52, gapCount: 5, scheduleSummary: [] },
        layoutDraft: { available: true, referencedByCurrentTask: true, completeness: { status: 'complete' } },
        review: {
          kind: 'formal_rebuild', action: 'formal_rebuild', summary: '待确认重新编排', riskLevel: 'high',
          allowedResponses: ['confirm', 'cancel'], expiresOnNextNonAnswer: false,
          formalRebuild: { actionKind: 'formal_orchestration', mode: 'full_generate', useLayoutDraft: true },
        },
        reactTask: { active: false },
        allowedActions: ['formal_orchestration'],
      } as never,
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(systemPrompt).toContain('review.formalRebuild')
    expect(systemPrompt).toContain('confirmExistingRebuild:true')
    expect(systemPrompt).toContain('东方卫视 当前版面 栏目候选')
    expect(systemPrompt).not.toContain('"queries":[]')
    expect(JSON.parse(userPrompt).foregroundContext.review).toMatchObject({
      kind: 'formal_rebuild',
      allowedResponses: ['confirm', 'cancel'],
      formalRebuild: { actionKind: 'formal_orchestration', mode: 'full_generate', useLayoutDraft: true },
    })
  })

  it('agent-planner-atomic-pending-action-v1-3: preserves structured pending confirmation', async () => {
    const testCase = {
      id: 'agent-planner-atomic-pending-action-v1-3',
      userInput: '确认',
      expectedDecision: 'atomic_command 保留 batch_delete + confirm',
      mustNotHappen: 'parser 丢弃 pendingAction 导致当成新任务',
      verification: 'plan.actions[0] 包含 pendingAction=confirm',
    }
    const planner = new AgentPlanner({
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          actions: [{ type: 'atomic_command', intent: 'batch_delete', pendingAction: 'confirm' }],
          assistantReplyDraft: '确认执行当前删除批次。',
        }),
      })),
    } as never)

    const plan = await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: false, itemCount: 2, gapCount: 0, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(plan.actions[0]).toMatchObject({ type: 'atomic_command', intent: 'batch_delete', pendingAction: 'confirm' })
  })

  it('agent-planner-top-level-start-new-task-v1-3: preserves explicit pending disposal for non-atomic work', async () => {
    const testCase = {
      id: 'agent-planner-top-level-start-new-task-v1-3',
      userInput: '当前播单有什么节目',
      expectedDecision: '顶层保留 pendingAction=start_new_task，并执行只读分析',
      mustNotHappen: 'parser 丢弃顶层 pendingAction，或本地根据新话题文本自动清理 pending',
      verification: 'plan.pendingAction=start_new_task 且 action=read_only_analysis',
    }
    const planner = new AgentPlanner({
      chat: vi.fn(async () => ({
        content: JSON.stringify({
          pendingAction: 'start_new_task',
          actions: [{ type: 'read_only_analysis', analysisKind: 'playlist_analysis' }],
          assistantReplyDraft: '我先只看当前编单，不会改动播单。',
        }),
      })),
    } as never)

    const plan = await planner.plan({
      scheduleState: {
        playlistId: 'playlist-a', playlistType: 'tv', channelId: 'dragon', channelName: '东方卫视', date: '2026-07-18',
        isEmpty: false, itemCount: 2, gapCount: 0, hasSelectedTimeRange: false,
      },
      userInput: testCase.userInput,
      currentSchedule: [],
    })

    expect(testCase).toMatchObject({ expectedDecision: expect.any(String), mustNotHappen: expect.any(String), verification: expect.any(String) })
    expect(plan.pendingAction).toBe('start_new_task')
    expect(plan.actions).toEqual([{ type: 'read_only_analysis', analysisKind: 'playlist_analysis' }])
  })
})
