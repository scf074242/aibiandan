import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { AgentPlanner } from '@/services/llm/agentPlanner'
import type { ChatMessage } from '@/types/llm'
import { buildForegroundAgentContextPackage } from '@/services/runtime/foregroundAgentContextPackage'
import { getSchedulingAgentRuntimeFacade, SchedulingAgentRuntimeFacade } from '@/services/runtime/schedulingAgentRuntimeFacade'
import { getSchedulingReactTaskRuntime } from '@/services/runtime/reactTaskRuntime'
import type { ReactTaskRun } from '@/services/runtime/reactTaskTypes'

describe('SchedulingAgentRuntimeFacade formal agent boundary', () => {
  it('keeps the real ChatPanel path on the formal runtime facade and records the server migration boundary', () => {
    const chatPanelSource = readFileSync(resolve(process.cwd(), 'src/components/dialogue/ChatPanel.vue'), 'utf8')
    const protocolDoc = readFileSync(resolve(process.cwd(), 'docs/agent-development-protocol.md'), 'utf8')

    expect(chatPanelSource).toContain('getSchedulingAgentRuntimeFacade')
    expect(chatPanelSource).toContain('@/services/runtime/schedulingAgentRuntimeFacade')
    expect(chatPanelSource).not.toContain('getDemoRuntimeFacade')
    expect(protocolDoc).toContain('Goal 39 服务端迁移边界')
    expect(protocolDoc).toContain('Goal 40 应开始拆服务端可访问边界')
    expect(protocolDoc).toContain('ChatPanel')
    expect(protocolDoc).toContain('不承担新的长程业务判断')
  })

  it('exposes the formal foreground runtime entry instead of requiring ChatPanel to import the legacy demo facade', () => {
    const facade = getSchedulingAgentRuntimeFacade()

    expect(facade).toBeInstanceOf(SchedulingAgentRuntimeFacade)
    expect(typeof facade.submitInstruction).toBe('function')
    expect(typeof facade.resolvePendingTargetSelection).toBe('function')
    expect(typeof facade.resolvePendingInsertRecommendation).toBe('function')
  })

  it('parses ReAct as a top-level planner mode and not as a normal action classifier branch', async () => {
    const planner = new AgentPlanner({
      chat: async () => ({
        content: JSON.stringify({
          mode: 'react',
          actions: [],
          reactTask: {
            objective: '先核验金山区热门景点素材，再决定是否更新草案',
            maxTurns: 3,
            batchSize: 4,
            stopCondition: '素材方向明确后进入草案确认，不直接写正式播单',
            nextActions: [
              {
                type: 'research_check',
                purpose: 'candidate_precheck',
                targetSegmentIndex: 1,
                semanticLabel: '金山区最近三年热门景点',
                programTypeHint: 'documentary',
                queries: ['金山区 近三年 热门景点 宣传片'],
              },
            ],
          },
          assistantReplyDraft: '我先查素材，确认前不会写入正式播单。',
          reasoning: '用户要求先查证再决定。',
        }),
      }),
    } as never)

    const plan = await planner.plan({
      scheduleState: {
        playlistId: 'rotation-1',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 1,
        hasSelectedTimeRange: false,
      },
      userInput: '第一段金山区景点部分，选择金山区最近3年最火热的景点',
      currentSchedule: [],
    })

    expect(plan.mode).toBe('react')
    expect(plan.actions).toEqual([])
    expect(plan.reactTask?.objective).toContain('金山区热门景点')
    expect(plan.reactTask?.nextActions).toHaveLength(1)
    expect(plan.reactTask?.nextActions[0]).toMatchObject({
      type: 'research_check',
      targetSegmentIndex: 1,
      semanticLabel: '金山区最近三年热门景点',
    })
  })

  it('keeps legacy react_task JSON compatible by lifting it into the formal top-level ReAct task', async () => {
    const planner = new AgentPlanner({
      chat: async () => ({
        content: JSON.stringify({
          actions: [
            {
              type: 'react_task',
              objective: '旧格式素材查证任务',
              maxTurns: 2,
              actions: [
                {
                  type: 'research_check',
                  semanticLabel: '静安区景点',
                  queries: ['静安区 景点 宣传片'],
                },
              ],
            },
          ],
        }),
      }),
    } as never)

    const plan = await planner.plan({
      scheduleState: {
        playlistId: 'rotation-1',
        playlistType: 'rotation',
        channelId: 'rotation',
        channelName: '轮播单',
        date: '2026-03-25',
        isEmpty: true,
        itemCount: 0,
        gapCount: 1,
        hasSelectedTimeRange: false,
      },
      userInput: '先查一下静安区景点素材',
      currentSchedule: [],
    })

    expect(plan.mode).toBe('react')
    expect(plan.actions).toEqual([])
    expect(plan.reactTask?.objective).toBe('旧格式素材查证任务')
    expect(plan.reactTask?.nextActions[0]).toMatchObject({
      type: 'research_check',
      semanticLabel: '静安区景点',
    })
  })

  it('passes active ReAct task observations into the LLM planner as continuation context', async () => {
    let capturedMessages: ChatMessage[] = []
    const activeReactTaskRun: ReactTaskRun = {
      id: 'react-task-retry',
      objective: '核验世界杯亚洲球队素材后继续细化草案',
      originalUserInput: '新建一个1小时轮播单，主要涵盖世界杯亚洲球队介绍',
      status: 'failed',
      loopCount: 1,
      limits: {
        maxTurns: 3,
        batchSize: 2,
      },
      stopCondition: '素材方向明确后再询问是否开始正式编排',
      steps: [{
        id: 'step-1',
        turn: 1,
        status: 'failed',
        action: {
          type: 'research_check',
          semanticLabel: '世界杯亚洲球队介绍',
          queries: ['世界杯 亚洲球队 介绍'],
        },
      }],
      observations: [{
        id: 'observation-1',
        turn: 1,
        type: 'runtime_failure',
        summary: '素材库网络超时，本轮没有修改草案或播单。',
        risk: 'network_timeout',
        createdAt: '2026-03-25T09:00:00.000Z',
      }],
      recovery: {
        canRetry: true,
        retryCount: 0,
        lastFailure: '素材库网络超时',
      },
      createdAt: '2026-03-25T09:00:00.000Z',
      updatedAt: '2026-03-25T09:01:00.000Z',
    }
    const scheduleState = {
      playlistId: 'rotation-1',
      playlistType: 'rotation',
      channelId: 'rotation',
      channelName: '轮播单',
      date: '2026-03-25',
      isEmpty: true,
      itemCount: 0,
      gapCount: 1,
      hasSelectedTimeRange: false,
      rotationStrategy: 'content_match',
      rotationDurationSeconds: 3600,
    } as const
    const contextPackage = buildForegroundAgentContextPackage({
      latestUserInput: '继续',
      scheduleState,
      currentSchedule: [],
      activeReactTaskRun,
    })
    const planner = new AgentPlanner({
      chat: async (messages: ChatMessage[]) => {
        capturedMessages = messages
        return {
          content: JSON.stringify({
            mode: 'react',
            actions: [],
            reactTask: {
              objective: '继续核验世界杯亚洲球队素材',
              maxTurns: 3,
              batchSize: 2,
              nextActions: [{
                type: 'research_check',
                semanticLabel: '世界杯亚洲球队介绍',
                queries: ['世界杯 亚洲球队 视频素材'],
              }],
            },
          }),
        }
      },
    } as never)

    await planner.plan({
      scheduleState,
      userInput: '继续',
      currentSchedule: [],
      contextPackage,
    })

    const systemPrompt = capturedMessages[0]?.content ?? ''
    const payload = JSON.parse(capturedMessages[1]?.content ?? '{}')

    expect(systemPrompt).toContain('foregroundContext.activeReactTask')
    expect(payload.foregroundContext.activeReactTask).toMatchObject({
      id: 'react-task-retry',
      status: 'failed',
      objective: '核验世界杯亚洲球队素材后继续细化草案',
      recovery: {
        canRetry: true,
        lastFailure: '素材库网络超时',
      },
      lastObservation: {
        type: 'runtime_failure',
        summary: '素材库网络超时，本轮没有修改草案或播单。',
      },
    })
    expect(payload.foregroundContext.activeReactTask.pendingSteps[0]).toMatchObject({
      type: 'research_check',
      semanticLabel: '世界杯亚洲球队介绍',
      queries: ['世界杯 亚洲球队 介绍'],
    })
    expect(JSON.stringify(payload.foregroundContext.activeReactTask)).not.toContain('originalUserInput')
  })

  it('creates a bounded LongTaskRun skeleton for future server-migratable execution', () => {
    const runtime = getSchedulingReactTaskRuntime()
    const run = runtime.startTask({
      originalUserInput: '先查金山区素材，再决定是否更新草案',
      plannerTask: {
        objective: '核验金山区景点素材',
        maxTurns: 99,
        batchSize: 99,
        stopCondition: '需要用户确认后才更新草案',
        nextActions: [
          {
            type: 'research_check',
            semanticLabel: '金山区景点',
            queries: ['金山区 景点 宣传片'],
          },
        ],
      },
      now: '2026-03-25T09:00:00.000Z',
    })

    expect(run.status).toBe('acting')
    expect(run.limits).toEqual({ maxTurns: 5, batchSize: 10 })
    expect(run.steps).toHaveLength(1)
    expect(run.stopCondition).toBe('需要用户确认后才更新草案')
  })

  it('keeps ReAct continuation deliberately small: next actions, one retry, and turn limit', () => {
    const runtime = getSchedulingReactTaskRuntime()
    const run = runtime.startTask({
      originalUserInput: '先查素材再决定怎么排',
      plannerTask: {
        objective: '查证素材并继续判断',
        maxTurns: 2,
        batchSize: 1,
        nextActions: [{
          type: 'research_check',
          semanticLabel: '静安区景点',
          queries: ['静安区 景点 宣传片'],
        }],
      },
      now: '2026-03-25T09:00:00.000Z',
    })
    const observed = runtime.recordObservation({
      run,
      type: 'asset_search',
      summary: '第一轮查到静安寺宣传片。',
      data: { candidateCount: 1 },
    })
    const continued = runtime.continueWithActions({
      run: observed,
      nextActions: [
        {
          type: 'research_check',
          semanticLabel: '静安寺宣传片',
          queries: ['静安寺 宣传片'],
        },
        {
          type: 'research_check',
          semanticLabel: '南京西路宣传片',
          queries: ['南京西路 宣传片'],
        },
      ],
      now: '2026-03-25T09:01:00.000Z',
    })
    const observedAgain = runtime.recordObservation({
      run: continued,
      type: 'asset_search',
      summary: '第二轮查到静安寺宣传片。',
      data: { candidateCount: 1 },
    })
    const failed = runtime.markFailed(continued, '素材库网络超时', '2026-03-25T09:02:00.000Z')
    const retry = runtime.markRetry(failed, '2026-03-25T09:03:00.000Z')
    const overLimit = runtime.continueWithActions({
      run: {
        ...retry,
        loopCount: retry.limits.maxTurns,
      },
      nextActions: [{
        type: 'research_check',
        semanticLabel: '下一轮',
        queries: ['下一轮'],
      }],
      now: '2026-03-25T09:04:00.000Z',
    })

    expect(observed.status).toBe('observing')
    expect(observed.loopCount).toBe(1)
    expect(continued.status).toBe('acting')
    expect(continued.steps.filter((step) => step.turn === 2)).toHaveLength(1)
    expect(observedAgain.steps).toEqual([
      expect.objectContaining({ turn: 1, status: 'observed' }),
      expect.objectContaining({ turn: 2, status: 'observed' }),
    ])
    expect(failed).toMatchObject({
      status: 'failed',
      recovery: {
        canRetry: true,
        retryCount: 0,
        lastFailure: '素材库网络超时',
      },
    })
    expect(retry.recovery).toMatchObject({
      canRetry: false,
      retryCount: 1,
      lastFailure: '素材库网络超时',
    })
    expect(overLimit).toMatchObject({
      status: 'failed',
      recovery: {
        canRetry: false,
        lastFailure: '已达到最多 2 轮处理上限。',
      },
    })
  })
})
