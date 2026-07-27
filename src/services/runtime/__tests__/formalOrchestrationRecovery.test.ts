import { describe, expect, it } from 'vitest'

import { createPendingTask } from '@/services/agent/agentSession'
import {
  prepareFormalOrchestrationRecovery,
  type FormalOrchestrationRecoveryInput,
} from '../formalOrchestrationRecovery'
import type { FormalOrchestrationCheckpoint } from '../formalOrchestrationRuntime'

interface TestAction { id: string; pendingAction?: 'confirm'; mutationPolicy?: 'formal_write' }

const checkpoints: FormalOrchestrationCheckpoint<TestAction>[] = [{
  id: 'run-1:checkpoint:1:continue',
  runId: 'run-1',
  objective: '补齐晚间空窗',
  turn: 1,
  actions: [{ id: 'a1' }],
  observations: [{
    id: 'observation-1',
    turn: 1,
    type: 'validation',
    summary: '候选 A 因版权状态未知被拒绝',
    risk: '版权状态未知',
    createdAt: '2026-07-19T00:00:00.000Z',
  }],
  decision: {
    kind: 'continue',
    nextActions: [{ id: 'a2' }, { id: 'a3' }],
    reason: '改查版权明确的候选',
  },
  failureReason: '候选 A 因版权状态未知被拒绝',
  createdAt: '2026-07-19T00:00:01.000Z',
}]

const baseInput = (
  overrides: Partial<FormalOrchestrationRecoveryInput<TestAction>> = {},
): FormalOrchestrationRecoveryInput<TestAction> => ({
  sessionId: 'session-1',
  action: 'inspect',
  requestedWorkspaceKey: 'rotation:rotation-1',
  checkpointWorkspaceKey: 'rotation:rotation-1',
  expectedPlaylistVersion: 'version-1',
  actualPlaylistVersion: 'version-1',
  checkpoints,
  ...overrides,
})

describe('formal orchestration cross-request recovery', () => {
  /**
   * case formal-react-resume-requires-explicit-user-action
   * - userInput: 恢复刚才中断的补排任务
   * - expectedDecision: 只返回继续、重试、缩小范围、取消等显式恢复动作，不自动执行
   * - mustNotHappen: 读取 checkpoint 后静默续跑或回退已完成写入
   * - verification: status=action_required 且 resumePlan 不可执行
   */
  it('requires an explicit user action before resuming', () => {
    const result = prepareFormalOrchestrationRecovery(baseInput())

    expect(result.status).toBe('action_required')
    expect(result.allowedActions).toEqual(['continue', 'retry', 'narrow_scope', 'cancel'])
    expect(result.resumePlan).toBeUndefined()
    expect(result.envelope.noMutation).toBe(true)
  })

  /**
   * case formal-react-resume-rejects-workspace-mismatch
   * - userInput: 在电视播单继续上一张轮播单的任务
   * - expectedDecision: 拒绝跨 workspace 恢复并暴露结构化原因
   * - mustNotHappen: 复用上一工作区 checkpoint、素材证据或正式写入上下文
   * - verification: status=rejected 且 kind=react_resume_workspace_mismatch
   */
  it('rejects a workspace mismatch', () => {
    const result = prepareFormalOrchestrationRecovery(baseInput({
      action: 'continue',
      requestedWorkspaceKey: 'tv:dragon:2026-07-19',
    }))

    expect(result.status).toBe('rejected')
    expect(result.envelope.kind).toBe('react_resume_workspace_mismatch')
    expect(result.resumePlan).toBeUndefined()
  })

  /**
   * case formal-react-resume-rejects-playlist-version-conflict
   * - userInput: 播单被人工修改后继续刚才的补排
   * - expectedDecision: 版本不一致时停止恢复，要求刷新后重新确认
   * - mustNotHappen: 在旧播单快照上继续写入或覆盖现场事实
   * - verification: status=rejected 且 kind=react_resume_version_conflict
   */
  it('rejects a formal playlist version conflict', () => {
    const result = prepareFormalOrchestrationRecovery(baseInput({
      action: 'continue',
      actualPlaylistVersion: 'version-2',
    }))

    expect(result.status).toBe('rejected')
    expect(result.envelope.kind).toBe('react_resume_version_conflict')
    expect(result.resumePlan).toBeUndefined()
  })

  it('rejects recovery when the current formal playlist version is missing', () => {
    const result = prepareFormalOrchestrationRecovery(baseInput({
      action: 'continue',
      actualPlaylistVersion: null,
    }))

    expect(result.status).toBe('rejected')
    expect(result.envelope.kind).toBe('react_resume_version_conflict')
  })

  /**
   * case formal-react-resume-skips-completed-idempotency-keys
   * - userInput: 网络断开后继续补排
   * - expectedDecision: 从半批次 checkpoint 继续时跳过已经产生 observation 的 action
   * - mustNotHappen: 重复执行已完成 action 或依赖回滚消除重复结果
   * - verification: resumePlan 只包含未完成 action，且暴露 skippedActionKeys
   */
  it('skips actions completed before a cancelled half batch', () => {
    const interrupted: FormalOrchestrationCheckpoint<TestAction> = {
      id: 'run-1:checkpoint:2:cancelled',
      runId: 'run-1',
      objective: '补齐晚间空窗',
      turn: 2,
      actions: [{ id: 'a2' }],
      observations: [{
        id: 'observation-2',
        turn: 2,
        type: 'formal_execution',
        summary: 'a2 已写入',
        createdAt: '2026-07-19T00:00:02.000Z',
      }],
      decision: { kind: 'cancelled', reason: '网络连接中断' },
      createdAt: '2026-07-19T00:00:03.000Z',
    }

    const result = prepareFormalOrchestrationRecovery(baseInput({
      action: 'continue',
      checkpoints: [...checkpoints, interrupted],
    }))

    expect(result.status).toBe('ready')
    expect(result.resumePlan?.nextActions).toEqual([{ id: 'a3' }])
    expect(result.resumePlan?.skippedActionKeys).toHaveLength(1)
    expect(result.resumePlan?.runId).toBe('run-1')
    expect(result.resumePlan?.workspaceKey).toBe('rotation:rotation-1')
  })

  /**
   * case formal-react-resume-preserves-last-rejection-evidence
   * - userInput: 缩小到晚间新闻时段后继续
   * - expectedDecision: 恢复计划携带上一轮拒绝原因和完整 checkpoint 上下文
   * - mustNotHappen: 压缩或恢复时丢失候选为何被拒绝的证据
   * - verification: resumePlan.lastFailureReason 与 checkpoint 原因一致
   */
  it('preserves the last rejection evidence', () => {
    const result = prepareFormalOrchestrationRecovery(baseInput({ action: 'narrow_scope' }))

    expect(result.status).toBe('ready')
    expect(result.resumePlan?.lastFailureReason).toBe('候选 A 因版权状态未知被拒绝')
    expect(result.resumePlan?.checkpoints).toEqual(checkpoints)
  })

  /**
   * case formal-react-pending-requires-explicit-confirm-action
   * - userInput: 继续刚才的删除
   * - expectedDecision: 普通 continue 不具备敏感删除授权，必须要求 confirm_pending
   * - mustNotHappen: 把“继续”解释成确认删除；生成可执行 resumePlan
   * - verification: status=action_required 且 resumePlan 缺失
   */
  it('does not treat continue as approval for a pending mutation', () => {
    const pendingTask = createPendingTask({
      intent: 'delete', phase: 'needs_confirmation', originalInput: '删除 item-1',
      collectedSlots: {}, missingSlots: ['confirmation'],
    })
    const waitingCheckpoint: FormalOrchestrationCheckpoint<TestAction> = {
      id: 'run-1:checkpoint:2:waiting_user', runId: 'run-1', objective: '删除前等待确认', turn: 2,
      actions: [{ id: 'delete-a' }, { id: 'validate-b' }],
      observations: [{
        id: 'pending-observation', turn: 2, type: 'atomic_execution', summary: '删除等待确认',
        data: { pendingMutation: { mutationPolicy: 'pending_only', pendingTask } },
        createdAt: '2026-07-20T00:00:00.000Z',
      }],
      decision: { kind: 'waiting_user', reason: '删除等待确认' }, createdAt: '2026-07-20T00:00:00.000Z',
    }

    const result = prepareFormalOrchestrationRecovery(baseInput({ action: 'continue', checkpoints: [waitingCheckpoint] }))

    expect(result.status).toBe('action_required')
    expect(result.resumePlan).toBeUndefined()
  })

  /**
   * case formal-react-confirm-pending-resumes-exact-action
   * - userInput: 确认删除 item-1
   * - expectedDecision: 显式确认只重放待确认 action，并保留同批尚未执行的校验动作
   * - mustNotHappen: 丢失 pendingTask；跳过后续动作；重放已经完成的前置动作
   * - verification: nextActions 首项 pendingAction=confirm，第二项仍为 validate-b
   */
  it('builds an exact resume plan after explicit pending confirmation', () => {
    const pendingTask = createPendingTask({
      intent: 'delete', phase: 'needs_confirmation', originalInput: '删除 item-1',
      collectedSlots: {}, missingSlots: ['confirmation'],
    })
    const waitingCheckpoint: FormalOrchestrationCheckpoint<TestAction> = {
      id: 'run-1:checkpoint:2:waiting_user', runId: 'run-1', objective: '删除前等待确认', turn: 2,
      actions: [{ id: 'delete-a' }, { id: 'validate-b' }],
      observations: [{
        id: 'pending-observation', turn: 2, type: 'atomic_execution', summary: '删除等待确认',
        data: { pendingMutation: { mutationPolicy: 'pending_only', pendingTask } },
        createdAt: '2026-07-20T00:00:00.000Z',
      }],
      decision: { kind: 'waiting_user', reason: '删除等待确认' }, createdAt: '2026-07-20T00:00:00.000Z',
    }

    const result = prepareFormalOrchestrationRecovery(baseInput({ action: 'confirm_pending', checkpoints: [waitingCheckpoint] }))

    expect(result.status).toBe('ready')
    expect(result.resumePlan?.pendingTask).toEqual(pendingTask)
    expect(result.resumePlan?.nextActions).toEqual([
      { id: 'delete-a', pendingAction: 'confirm', mutationPolicy: 'formal_write' },
      { id: 'validate-b' },
    ])
  })
})
