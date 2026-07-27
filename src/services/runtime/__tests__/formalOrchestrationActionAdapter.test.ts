import { describe, expect, it, vi } from 'vitest'

import { FormalOrchestrationActionAdapter } from '../formalOrchestrationActionAdapter'

const context = {
  run: {
    id: 'run-1', objective: '补齐晚间空窗', originalUserInput: '补齐晚间空窗', status: 'acting' as const,
    loopCount: 0, limits: { maxTurns: 3, batchSize: 2 }, steps: [], observations: [], createdAt: '', updatedAt: '',
  },
  turn: 1,
}

describe('FormalOrchestrationActionAdapter', () => {
  /**
   * case formal-action-readonly-workspace-evidence
   * - userInput: 先查节目库再决定
   * - expectedDecision: research_check 只调用只读端口并返回当前 workspace 的 observation
   * - mustNotHappen: 产生 mutation；复用其他 workspace 的证据
   * - verification: observation.noMutation=true 且 workspaceKey 一致
   */
  it('keeps research actions read-only and workspace scoped', async () => {
    const researchCheck = vi.fn(async () => ({ workspaceKey: 'ws-a', summary: '找到 3 个候选', noMutation: true, data: { candidateCount: 3 } }))
    const adapter = new FormalOrchestrationActionAdapter({ workspaceKey: 'ws-a', ports: { researchCheck } })

    const observation = await adapter.execute({ type: 'research_check', queries: ['新闻'] }, context)

    expect(researchCheck).toHaveBeenCalledTimes(1)
    expect(observation).toMatchObject({ type: 'asset_search', summary: '找到 3 个候选', data: { workspaceKey: 'ws-a', noMutation: true } })
  })

  /**
   * case formal-action-mutation-policy-required
   * - userInput: 将候选插入正式播单
   * - expectedDecision: 原子动作缺少 mutationPolicy 时在端口调用前阻断
   * - mustNotHappen: 默认回退 formal_write；调用写入端口
   * - verification: 抛 mutationPolicy required，atomicCommand 未调用
   */
  it('rejects atomic actions without an explicit mutation policy', async () => {
    const atomicCommand = vi.fn()
    const adapter = new FormalOrchestrationActionAdapter({ workspaceKey: 'ws-a', ports: { atomicCommand } })

    await expect(adapter.execute({ type: 'atomic_command', intent: 'insert', targetTime: '09:00:00' }, context))
      .rejects.toThrow('mutationPolicy')
    expect(atomicCommand).not.toHaveBeenCalled()
  })

  /**
   * case formal-action-cross-workspace-rejected
   * - userInput: 继续上一轮候选核验
   * - expectedDecision: 端口返回其他 workspaceKey 时拒绝 observation
   * - mustNotHappen: 跨播单复用候选证据
   * - verification: 抛 workspace mismatch
   */
  it('rejects evidence returned from another workspace', async () => {
    const adapter = new FormalOrchestrationActionAdapter({
      workspaceKey: 'ws-a',
      ports: { validate: vi.fn(async () => ({ workspaceKey: 'ws-b', summary: '校验完成', noMutation: true })) },
    })

    await expect(adapter.execute({ type: 'validate' }, context)).rejects.toThrow('workspace mismatch')
  })

  /**
   * case formal-rebuild-grant-is-workspace-scoped
   * - userInput: 在另一张播单继续已确认的整批重编
   * - expectedDecision: formal_write 在端口调用前校验运行时 Grant 的 workspace
   * - mustNotHappen: 跨播单复用授权；调用 atomicCommand
   * - verification: 抛 workspace mismatch，atomicCommand 未调用
   */
  it('rejects a resolved rebuild grant from another workspace before mutation', async () => {
    const atomicCommand = vi.fn()
    const adapter = new FormalOrchestrationActionAdapter({
      workspaceKey: 'ws-b',
      authorization: {
        kind: 'confirmed_formal_rebuild', grantId: 'grant-1', sessionId: 'session-a', sourcePendingId: 'pending-a',
        workspaceKey: 'ws-a', initialPlaylistVersion: 'formal-v1', draftFingerprint: 'draft-fp-1',
        mode: 'full_generate', existingItemCount: 1,
        allowedIntents: ['move', 'insert', 'replace', 'delete', 'batch_move', 'batch_delete', 'validate'],
        issuedAt: '2026-07-21T10:00:00.000Z', expiresAt: '2099-07-21T10:10:00.000Z', status: 'active',
      } as any,
      ports: { atomicCommand },
    })

    await expect(adapter.execute({
      type: 'atomic_command', intent: 'replace', targetItemId: 'item-1',
      candidateId: 'candidate-1', mutationPolicy: 'formal_write',
    }, context)).rejects.toThrow('workspace mismatch')
    expect(atomicCommand).not.toHaveBeenCalled()
  })

  /**
   * case formal-action-control-recursion-blocked
   * - userInput: 全天编排
   * - expectedDecision: formal_orchestration 控制动作不得作为 ReAct batch action 再次启动长流程
   * - mustNotHappen: 递归启动 FormalOrchestrationRuntime 或旧 Orchestrator
   * - verification: 适配器在任何端口调用前拒绝 control-plane action
   */
  it('blocks control-plane actions from recursively entering the batch actor', async () => {
    const adapter = new FormalOrchestrationActionAdapter({ workspaceKey: 'ws-a', ports: {} })

    await expect(adapter.execute({ type: 'formal_orchestration', mode: 'full_generate', taskKind: 'full_day' }, context))
      .rejects.toThrow('control-plane')
  })
})
