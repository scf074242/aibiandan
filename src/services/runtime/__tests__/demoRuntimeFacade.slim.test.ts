import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('DemoRuntimeFacade slim orchestration delegation (D23/D10)', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/runtime/demoRuntimeFacade.ts'), 'utf8')

  it('delegates formal orchestration decision building to FormalOrchestrationCapability', () => {
    expect(source).toContain('private readonly formalOrchestrationCapability = new FormalOrchestrationCapability()')
    expect(source).toContain('return this.formalOrchestrationCapability.buildFormalOrchestrationDecision(')
    expect(source).toContain('return this.formalOrchestrationCapability.buildFormalOrchestrationDecisionForMode(')
    expect(source).toContain('return this.formalOrchestrationCapability.buildCommitLayoutDraftDecision(')
  })

  it('no longer contains legacy orchestration helper methods', () => {
    expect(source).not.toContain('private resolveFormalOrchestrationBasis')
    expect(source).not.toContain('private buildMissingFormalOrchestrationBasisBlock')
    expect(source).not.toContain('private buildFormalOrchestrationLifecycle')
    expect(source).not.toContain('private buildFormalRebuildConfirmationDecision')
    expect(source).not.toContain('private resolveExistingFormalItemCount')
    expect(source).not.toContain('private shouldRequireFormalRebuildConfirmation')
    expect(source).not.toContain('private resolveFormalOrchestrationTargetTimeRange')
    expect(source).not.toContain('private resolveFormalOrchestrationTaskKind')
  })

  it('keeps the formal orchestration adapter for capability injection', () => {
    expect(source).toContain('private buildFormalOrchestrationAdapter(): FormalOrchestrationAdapter')
    expect(source).toContain('resolveExistingLayoutDraft: (input, userIntent, ignoreExistingLayout) =>')
    expect(source).toContain('parseCompactHourRange: (userInput) => this.parseCompactHourRange(userInput)')
  })
})
