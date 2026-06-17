import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const chatPanelSource = readFileSync(resolve(currentDir, '../ChatPanel.vue'), 'utf-8')
const broadcastPlanSource = readFileSync(resolve(currentDir, '../../../views/broadcast-plan/create.vue'), 'utf-8')
const orchestrationHookSource = readFileSync(resolve(currentDir, '../../../views/broadcast-plan/useBroadcastPlanOrchestration.ts'), 'utf-8')

describe('ChatPanel quick actions', () => {
  it('does not expose long-flow scheduling as atomic quick actions', () => {
    const quickActionsBlock = chatPanelSource.match(/const quickActions[\s\S]*?= \[[\s\S]*?\n\]/)?.[0] ?? ''

    expect(quickActionsBlock).toContain('新建电视播单')
    expect(quickActionsBlock).toContain('新建轮播单')
    expect(quickActionsBlock).toContain('内容匹配优先')
    expect(quickActionsBlock).toContain('收视率优先')
    expect(quickActionsBlock).toContain('热播优先')
    expect(quickActionsBlock).toContain('顺播上下文')
    expect(quickActionsBlock).toContain('SEED_TV_SEQUENCE_CONTEXT_PROMPT')
    expect(quickActionsBlock).toContain('顺播倒序')
    expect(quickActionsBlock).toContain('08:00 插入纵有疾风起第2集')
    expect(quickActionsBlock).toContain('插入节目')
    expect(quickActionsBlock).toContain('插入短片')
    expect(quickActionsBlock).toContain('0点插入城市形象春日花路短片')
    expect(quickActionsBlock).toContain("{ label: '插入短片', prompt: '0点插入城市形象春日花路短片', playlistTypes: ['rotation'] }")
    expect(quickActionsBlock).toContain('替换节目')
    expect(quickActionsBlock).toContain('删除节目')
    expect(quickActionsBlock).toContain('后移节目')
    expect(quickActionsBlock).toContain('前移节目')
    expect(quickActionsBlock).toContain('查询节目')
    expect(quickActionsBlock).toContain('9点是什么节目')
    expect(quickActionsBlock).toContain('按内容匹配优先')
    expect(quickActionsBlock).toContain('按收视率优先')
    expect(quickActionsBlock).toContain('按热播优先')
    expect(quickActionsBlock).toContain('把9点的节目向后移动1小时')
    expect(quickActionsBlock).toContain('把10点的节目向前移动1小时')
    expect(quickActionsBlock).not.toContain('把22点的节目向后移动1小时')
    expect(quickActionsBlock).not.toContain('全天编排')
    expect(quickActionsBlock).not.toContain('补齐空窗')
    expect(quickActionsBlock).not.toContain('缺时间插入')
    expect(quickActionsBlock).not.toContain("prompt: '插入看东方'")
    expect(chatPanelSource).toContain('const visibleQuickActions = computed')
    expect(chatPanelSource).toContain('action.playlistTypes.includes(activePlaylistType.value)')
    expect(chatPanelSource).toContain(':disabled="loading"')
    expect(chatPanelSource).toContain("emit('seedTvSequenceContextRequested')")
    expect(chatPanelSource).toContain('后续插入或替换同系列节目时')
    expect(broadcastPlanSource).toContain('@seed-tv-sequence-context-requested="handleSeedTvSequenceContext"')
    expect(broadcastPlanSource).toContain('persistCurrentPlaylistDocument()')
  })

  it('syncs runtime playlist state details back to the parent page', () => {
    expect(chatPanelSource).toContain('const applyPlaylistStateFromDetails')
    expect(chatPanelSource).toContain('details?.playlistState')
    expect(chatPanelSource).toContain('playlistId: playlistState.playlistId')
    expect(chatPanelSource).toContain('channelName: activePlaylistType.value === \'tv\' ? playlistState.channelName : undefined')
    expect(chatPanelSource).toContain('date: activePlaylistType.value === \'tv\' ? playlistState.date : undefined')
    expect(chatPanelSource).toContain('activePlaylistType.value = playlistState.playlistType')
    expect(chatPanelSource).toContain("emit('playlistStateChanged'")
    expect(chatPanelSource).toContain("rotationStrategy: activePlaylistType.value === 'rotation' ? activeRotationStrategy.value : undefined")
    expect(chatPanelSource).toContain('playlistType: activePlaylistType.value')
    expect(chatPanelSource).toContain("rotationStrategy: activePlaylistType.value === 'rotation' ? activeRotationStrategy.value : undefined")
    expect(chatPanelSource).toContain('activeRotationDurationSeconds.value = activePlaylistType.value === \'rotation\' && typeof playlistState.rotationDurationSeconds === \'number\'')
    expect(chatPanelSource).toContain('rotationDurationSeconds: activePlaylistType.value === \'rotation\' ? activeRotationDurationSeconds.value ?? undefined : undefined')
  })

  it('opens playlist file cards by stable playlist id', () => {
    expect(chatPanelSource).toContain('playlistId?: string')
    expect(chatPanelSource).toContain('playlistId: card.playlistId')
    expect(chatPanelSource).toContain('explanation: feedback.explanation || details')
    expect(broadcastPlanSource).toContain('type PlaylistDocumentState')
    expect(broadcastPlanSource).toContain('const playlistDocuments')
    expect(broadcastPlanSource).toContain('const openPlaylistDocument')
    expect(broadcastPlanSource).toContain('payload.playlistId')
    expect(broadcastPlanSource).toContain('playlistDocuments.value.find((item) => item.id === payload.playlistId)')
  })

  it('persists the active playlist document after foreground Agent writeback', () => {
    expect(broadcastPlanSource).toContain('persistCurrentPlaylistDocument,')
    expect(orchestrationHookSource).toContain('persistCurrentPlaylistDocument: () => void')
    expect(orchestrationHookSource).toContain('options.applyRuntimeScheduleItems(items)')
    expect(orchestrationHookSource).toContain('options.persistCurrentPlaylistDocument()')
    expect(orchestrationHookSource.indexOf('options.applyRuntimeScheduleItems(items)')).toBeLessThan(
      orchestrationHookSource.indexOf('options.persistCurrentPlaylistDocument()'),
    )
  })

  it('renders playlist file cards from snapshot metadata rather than current page props', () => {
    expect(chatPanelSource).toContain('playlistState.channelName.trim()')
    expect(chatPanelSource).toContain('playlistState.date.trim()')
    expect(chatPanelSource).toContain('title: `${channelName}电视播单`')
    expect(chatPanelSource).toContain('meta: `${date} · ${channelName} · 编排内容`')
    expect(broadcastPlanSource).toContain('channelName?: string')
    expect(broadcastPlanSource).toContain('date?: string')
    expect(broadcastPlanSource).toContain('scheduleForm.value.channelName = document.channelName')
    expect(broadcastPlanSource).toContain('scheduleForm.value.date = document.date')
  })

  it('keeps the AI conversation as a permanent primary entry', () => {
    expect(broadcastPlanSource).toContain('<div class="content-wrapper with-ai-sidebar">')
    expect(broadcastPlanSource).toContain('<div class="ai-sidebar">')
    expect(broadcastPlanSource).not.toContain('aiSidebarVisible = false')
    expect(broadcastPlanSource).not.toContain('<Close')
  })

  it('keeps layout draft viewing out of the foreground conversation and playlist workspace', () => {
    expect(chatPanelSource).not.toContain('v-if="pendingLayoutDraft" class="pending-command-panel layout-draft-panel"')
    expect(chatPanelSource).not.toContain('class="layout-upload-status"')
    expect(chatPanelSource).toContain('const containsForegroundDraftPayload')
    expect(chatPanelSource).toContain('hiddenFromThread?: boolean')
    expect(chatPanelSource).toContain('const hiddenFromThread = input.hiddenFromThread')
    expect(chatPanelSource).toContain('|| (!foregroundLayoutDraftEnabled && containsForegroundDraftPayload(input))')
    expect(chatPanelSource).toContain('messages.value.filter((message) => !message.hiddenFromThread && !isForegroundLayoutDraftMessage(message))')
    expect(chatPanelSource).toContain('const sanitizeForegroundDraftText')
    expect(chatPanelSource).toContain('const sanitizeForegroundDraftPayload')
    expect(chatPanelSource).toContain('const sanitizeAssistantMessageInput')
    expect(chatPanelSource).toContain('const isForegroundDraftPayloadKey')
    expect(chatPanelSource).toContain('value.includes(\'编排参考\')')
    expect(chatPanelSource).toContain('isForegroundDraftPayloadKey(key)')
    expect(chatPanelSource).toContain('sanitizeForegroundDraftPayload(input.explanation)')
    expect(chatPanelSource).toContain('const getVisibleMessageDetails')
    expect(chatPanelSource).toContain('buildDetailsSummary(getVisibleMessageDetails(message), message.processType)')
    expect(chatPanelSource).toContain('v-if="getDetailsSummaryItems(message).length > 0 || getVisibleMessageDetails(message)"')
    expect(chatPanelSource).not.toContain('v-if="getDetailsSummaryItems(message).length > 0 || message.explanation?.details"')
    expect(chatPanelSource).toContain('Boolean(getVisibleMessageDetails(message))')
    expect(chatPanelSource).toContain('normalizedKey === \'layoutdraft\'')
    expect(chatPanelSource).toContain('normalizedKey === \'draftid\'')
    expect(chatPanelSource).toContain('normalizedKey === \'layoutsource\'')
    expect(chatPanelSource).toContain('formatStructuredDetails(sanitizeForegroundDraftPayload(details), formatDisplayTime)')
    expect(chatPanelSource).toContain('const isForegroundLongFlowDetails')
    expect(chatPanelSource).toContain('isOrchestrationOverviewDetails(details)')
    expect(chatPanelSource).toContain('containsForegroundDraftPayload(message.explanation?.explanation)')
    expect(chatPanelSource).toContain("if (message.role === 'user') return false")
    expect(chatPanelSource).not.toContain("if (foregroundLayoutDraftEnabled || message.role === 'user') return false")
    expect(chatPanelSource).not.toContain('当前版面参考</span>')
    expect(broadcastPlanSource).not.toContain('const foregroundLayoutDraftWorkspaceEnabled = false')
    expect(broadcastPlanSource).toContain('const showLayoutDraftWorkspace = computed(() => playlistType.value === \'tv\')')
    expect(broadcastPlanSource).toContain('const currentPlaylistWorkspaceKicker = computed(() => {')
    expect(broadcastPlanSource).toContain('class="playlist-workspace-tabs" :class="{ \'is-disabled\': playlistType === \'none\' }"')
    expect(broadcastPlanSource.indexOf('class="playlist-workspace-tabs"')).toBeLessThan(
      broadcastPlanSource.indexOf('class="playlist-workspace-title"'),
    )
    expect(broadcastPlanSource).toContain('justify-content: space-between;')
    expect(broadcastPlanSource).toContain('text-align: right;')
    expect(broadcastPlanSource).not.toContain('const showPlaylistWorkspaceTabs = computed(() => playlistType.value !== \'none\')')
    expect(broadcastPlanSource).not.toContain('v-if="showPlaylistWorkspaceTabs" class="playlist-workspace-tabs"')
    expect(broadcastPlanSource).toContain('v-if="playlistType === \'tv\'"')
    expect(broadcastPlanSource).toContain(':disabled="!showLayoutDraftWorkspace"')
    expect(broadcastPlanSource).toContain('v-else-if="showLayoutDraftWorkspace && currentLayoutDraft" class="layout-draft-workspace"')
    expect(broadcastPlanSource).toContain('v-else-if="showLayoutDraftWorkspace" class="layout-draft-workspace is-empty"')
    expect(broadcastPlanSource).toContain('if (playlistType.value === \'rotation\')')
    expect(broadcastPlanSource).toContain('class="layout-draft-workspace"')
    expect(broadcastPlanSource).not.toContain('class="layout-draft-empty"')
    expect(broadcastPlanSource).not.toContain('还没有版面草案')
  })

  it('describes rotation playlists as duration based instead of concrete date or time ranges', () => {
    expect(chatPanelSource).toContain('时长制：总时长 ${formatPlaylistDurationText(rotationDurationSeconds)}，0 点起算')
    expect(chatPanelSource).toContain('时长制：0 点起算，待确定总时长')
    expect(chatPanelSource).not.toContain('00:00:00 至 ${formatPlaylistClockText(rotationDurationSeconds)}')
    expect(broadcastPlanSource).toContain("const timelineStartHeaderLabel = computed(() => playlistType.value === 'rotation' ? '起始位置' : '起始时间')")
    expect(broadcastPlanSource).toContain("const timelineEndHeaderLabel = computed(() => playlistType.value === 'rotation' ? '结束位置' : '结束时间')")
    expect(broadcastPlanSource).toContain('时长制 · 总时长 ${formatDurationScopeText(rotationTargetDurationSeconds.value)} · 0 点起算')
    expect(broadcastPlanSource).toContain('时长制 · 待确定总时长 · 0 点起算')
    expect(broadcastPlanSource).toContain("() => playlistType.value === 'rotation'")
    expect(broadcastPlanSource).toContain('? rotationDurationScopeText.value')
    expect(broadcastPlanSource).not.toContain('00:00:00 至 ${secondsToClockText(rotationTargetDurationSeconds.value)}')
    expect(broadcastPlanSource).toContain('layoutDraft: playlistType.value === \'tv\' ? currentLayoutDraft.value : null')
    expect(broadcastPlanSource).toContain('currentLayoutDraft.value = document.playlistType === \'tv\' ? document.layoutDraft : null')
  })

  it('formats rotation ranges as duration and relative position in the foreground chat', () => {
    expect(chatPanelSource).toContain('总时长${durationText}，0点起算')
    expect(chatPanelSource).toContain('相对位置 +${formatPlaylistDurationText(startSeconds)}，持续${durationText}')
    expect(chatPanelSource).toContain('\\d{1,2}:\\d{2}(?::\\d{2})?')
    expect(chatPanelSource).not.toContain('0点起算，持续${durationText}')
  })

  it('routes the real foreground conversation through the scheduling runtime directly', () => {
    expect(chatPanelSource).toContain('const runtimeFacade = getDemoRuntimeFacade()')
    expect(chatPanelSource).toContain('const decision = await runtimeFacade.submitInstruction')
    expect(chatPanelSource).toContain('agentCoreEnabled: true')
    expect(chatPanelSource).toContain('const foregroundLayoutDraftEnabled = false')
    expect(chatPanelSource).toContain('layoutDraftEnabled: foregroundLayoutDraftEnabled')
    expect(chatPanelSource).toContain('currentLayoutDraft: foregroundLayoutDraftEnabled ? pendingLayoutDraft.value : null')
    expect(chatPanelSource).toContain('runtimeFacade.executePendingCommand')
    expect(chatPanelSource).toContain('runtimeFacade.resolvePendingTargetSelection')
    expect(chatPanelSource).toContain('runtimeFacade.resolvePendingInsertRecommendation')
    expect(chatPanelSource).not.toContain('openClawBridge.submitInstruction')
    expect(chatPanelSource).not.toContain('getOpenClawBridge')
  })

  it('keeps the broadcast-plan foreground page off the OpenClaw host bridge', () => {
    expect(broadcastPlanSource).not.toContain('getOpenClawHostAdapter')
    expect(broadcastPlanSource).not.toContain('openClawHostAdapter')
    expect(broadcastPlanSource).not.toContain('bigbiandan.openclaw')
  })

  it('syncs successful runtime execution back from runtime or atomic state', () => {
    expect(chatPanelSource).toContain('const emitLatestRuntimeSchedule')
    expect(chatPanelSource).toContain('resolveScheduleItemsFromExecutionData(executionData)')
    expect(chatPanelSource).toContain('getAtomicCapabilities().getAllItems()')
    expect(chatPanelSource).toContain('emitLatestRuntimeSchedule(executed.data)')
    expect(chatPanelSource).toContain('emitLatestRuntimeSchedule(result.data)')
    expect(chatPanelSource).not.toContain('if (executionResult?.scheduleItems)')
  })

  it('captures pending summaries before cancelling bridge sessions', () => {
    const pendingCommandCancelBlock = chatPanelSource.match(/const cancelPendingCommand = async \(\) => \{[\s\S]*?\n\}/)?.[0] ?? ''
    const pendingAtomicCancelBlock = chatPanelSource.match(/const cancelPendingAtomicContext = async \(\) => \{[\s\S]*?\n\}/)?.[0] ?? ''

    expect(pendingCommandCancelBlock).toContain('const summary = pendingCommand.value.summary.replace')
    expect(pendingCommandCancelBlock.indexOf('const summary = pendingCommand.value.summary.replace')).toBeLessThan(
      pendingCommandCancelBlock.indexOf('pendingCommand.value = null'),
    )
    expect(pendingCommandCancelBlock).toContain('content: `${summary}，已取消执行。`')
    expect(pendingAtomicCancelBlock).toContain('const summary = formatPendingAtomicSummary(pendingAtomicContext.value).replace')
    expect(pendingAtomicCancelBlock.indexOf('const summary = formatPendingAtomicSummary(pendingAtomicContext.value).replace')).toBeLessThan(
      pendingAtomicCancelBlock.indexOf('pendingAtomicContext.value = null'),
    )
    expect(pendingAtomicCancelBlock).toContain('content: `${summary}，已取消当前补参。`')
  })

  it('surfaces Agent Core audit summaries as first-class decision evidence', () => {
    expect(chatPanelSource).toContain('interface AgentAuditCard')
    expect(chatPanelSource).toContain('const getAgentAuditCards')
    expect(chatPanelSource).toContain('getMessageDetails(message)?.auditSummary')
    expect(chatPanelSource).toContain('class="agent-audit-panel"')
    expect(chatPanelSource).toContain('class="agent-audit-card"')
    expect(chatPanelSource).toContain('.agent-audit-card.is-blocker')
    expect(chatPanelSource).toContain('.agent-audit-card.is-warning')
  })

  it('keeps Agent Core search and LLM context budget in expandable decision evidence', () => {
    expect(chatPanelSource).toContain('interface AgentSearchSummaryCard')
    expect(chatPanelSource).toContain('const getAgentSearchSummaryCards')
    expect(chatPanelSource).toContain('class="agent-search-panel"')
    expect(chatPanelSource).toContain('检索与上下文')
    expect(chatPanelSource).not.toContain('class="agent-search-panel is-inline"')
    expect(chatPanelSource).toContain('class="agent-search-card"')
    expect(chatPanelSource).toContain('candidateSource?.query')
    expect(chatPanelSource).toContain('query?.facets')
    expect(chatPanelSource).toContain('candidateSource?.recordCount')
    expect(chatPanelSource).toContain('details.agentEvidenceBudget')
    expect(chatPanelSource).toContain('getBudgetLine(\'候选证据\'')
    expect(chatPanelSource).toContain('已按上下文预算裁剪')
  })

  it('surfaces Agent Core pending LLM context inside pending atomic panels', () => {
    expect(chatPanelSource).toContain("import { buildPendingLlmContext } from '@/services/agent/agentSession'")
    expect(chatPanelSource).toContain('const getPendingAtomicContextDetailItems')
    expect(chatPanelSource).toContain('agentPendingLlmContext: buildPendingLlmContext(agentPendingTask')
    expect(chatPanelSource).toContain('pending-agent-context-list')
    expect(chatPanelSource).toContain('{{ item.label }}')
    expect(chatPanelSource).toContain('{{ item.value }}')
  })

  it('builds runtime history from visible conversation only', () => {
    expect(chatPanelSource).toContain('const buildVisibleRuntimeHistory')
    expect(chatPanelSource).toContain('visibleMessages.value')
    expect(chatPanelSource).toContain("message.role === 'user' ? '用户' : '助手'")
    expect(chatPanelSource).toContain('history: buildVisibleRuntimeHistory(content)')
    expect(chatPanelSource).not.toContain('history: messages.value.slice(-6).map((message) => message.content)')
  })

  it('renders foreground confirmation controls for Agent Core pending writes', () => {
    expect(chatPanelSource).toContain('showAgentPendingConfirmationPanel')
    expect(chatPanelSource).toContain('class="pending-command-panel agent-confirmation-panel"')
    expect(chatPanelSource).toContain('待确认执行')
    expect(chatPanelSource).toContain('confirmPendingAgentTask')
    expect(chatPanelSource).toContain('rejectPendingAgentTask')
    expect(chatPanelSource).toContain('await processMessage(content)')
    expect(chatPanelSource).toContain(':disabled="loading" @click="confirmPendingAgentTask"')
    expect(chatPanelSource).toContain(':disabled="loading" @click="rejectPendingAgentTask"')
    expect(chatPanelSource).toContain('formatPendingAtomicSummary(pendingAtomicContext)')
    expect(chatPanelSource).toContain('formatPendingAtomicConfirmationNote(pendingAtomicContext)')
  })

  it('keeps Agent Core as the continuation path for pending card selections', () => {
    const targetSelectionBlock = chatPanelSource.match(/const confirmPendingTargetSelection = async \(\) => \{[\s\S]*?const confirmPendingInsertRecommendation/)?.[0] ?? ''
    const insertRecommendationBlock = chatPanelSource.match(/const confirmPendingInsertRecommendation = async \(\) => \{[\s\S]*?const continuePendingAgentTask/)?.[0] ?? ''

    expect(chatPanelSource).toContain('const patchPendingAgentTaskSelection')
    expect(chatPanelSource).toContain("slot: 'targetItemId'")
    expect(chatPanelSource).toContain("slot: 'candidateId'")
    expect(chatPanelSource).toContain("source: selection.slot === 'candidateId' ? 'candidate_selection' as const : 'user_followup' as const")
    expect(chatPanelSource).toContain('missingSlots: pendingTask.missingSlots.filter')
    expect(chatPanelSource).toContain("phase: 'needs_confirmation' as const")
    expect(chatPanelSource).toContain("allowedActions: ['confirm', 'reject', 'start_new_task', 'cancel_pending']")

    expect(targetSelectionBlock).toContain('pendingAtomicContext.value.agentPendingTask')
    expect(targetSelectionBlock).toContain("slot: 'targetItemId'")
    expect(targetSelectionBlock).toContain("await continuePendingAgentTask('确认')")
    expect(targetSelectionBlock.indexOf("await continuePendingAgentTask('确认')")).toBeLessThan(
      targetSelectionBlock.indexOf('rehydratePendingTargetSelectionFromAtomicContext'),
    )
    expect(targetSelectionBlock).toContain('runtimeFacade.resolvePendingTargetSelection')

    expect(insertRecommendationBlock).toContain('pendingAtomicContext.value.agentPendingTask')
    expect(insertRecommendationBlock).toContain("slot: 'candidateId'")
    expect(insertRecommendationBlock).toContain("await continuePendingAgentTask('确认')")
    expect(insertRecommendationBlock.indexOf("await continuePendingAgentTask('确认')")).toBeLessThan(
      insertRecommendationBlock.indexOf('rehydratePendingInsertRecommendationFromAtomicContext'),
    )
    expect(insertRecommendationBlock).toContain('runtimeFacade.resolvePendingInsertRecommendation')
  })

  it('keeps foreground pending interactions limited to actionable cards', () => {
    expect(chatPanelSource).toContain('const formatPendingAgentTaskState')
    expect(chatPanelSource).toContain('const formatPendingAtomicGuidance')
    expect(chatPanelSource).toContain('const formatPendingAtomicKnownFacts')
    expect(chatPanelSource).toContain('const formatPendingAtomicConfirmationNote')
    expect(chatPanelSource).toContain('context.confirmationNote || context.reasoning')
    expect(chatPanelSource).toContain('const showClarifyingAtomicPanel = computed(() => false)')
    expect(chatPanelSource).not.toContain('showClarifyingAtomicPanel && pendingAtomicContext')
    expect(chatPanelSource).not.toContain('class="pending-command-panel clarifying-panel"')
    expect(chatPanelSource).toContain('class="pending-command-panel agent-confirmation-panel"')
    expect(chatPanelSource).toContain('class="playlist-file-card"')
    expect(chatPanelSource).toContain('class="pending-command-panel insert-recommendation-panel"')
    expect(chatPanelSource).toContain('showTargetSelectionAtomicPanel')
    expect(chatPanelSource).toContain('const getPendingAtomicClarificationSuggestions')
    expect(chatPanelSource).toContain("{ label: '9点', prompt: '9点' }")
    expect(chatPanelSource).toContain("{ label: '10点', prompt: '10点' }")
    expect(chatPanelSource).toContain('const continuePendingAtomicClarification')
    expect(chatPanelSource).toContain('void sendMessage()')
    expect(chatPanelSource).toContain('我已经识别到要插入')
    expect(chatPanelSource).toContain('还需要你告诉我放到哪个播出位置')
    expect(chatPanelSource).toContain('已预演，等待确认写入')
    expect(chatPanelSource).toContain("push('处理状态', formatPendingAgentTaskState(pendingTask.phase))")
    expect(chatPanelSource).not.toContain("push('上下文状态', `${pendingTask.intent} · ${pendingTask.phase}`)")
    expect(chatPanelSource).not.toContain('动作：{{ formatAtomicActionLabel')
    expect(chatPanelSource).not.toContain('缺少：{{ formatAtomicMissingFieldLabel')
    expect(chatPanelSource).toContain('已定位：${targetPart}')
    expect(chatPanelSource).toContain('确认后删除，取消则不改动播单')
    expect(chatPanelSource).toContain(':disabled="loading || !pendingAtomicTargetSelectedItemId"')
    expect(chatPanelSource).toContain(':disabled="loading || !pendingAtomicInsertSelectedCandidateId"')
  })

  it('clears stale pending Agent context when a new foreground runtime message resolves', () => {
    const messageDecisionBlock = chatPanelSource.match(/case 'message':[\s\S]*?return/)?.[0] ?? ''

    expect(messageDecisionBlock).toContain('appendRuntimeFeedback(decision.feedback)')
    expect(messageDecisionBlock).toContain('pendingAtomicContext.value = decision.pendingAtomicClarification')
    expect(messageDecisionBlock).toContain(': null')
  })

  it('clears stale pending tasks when the active playlist document changes', () => {
    expect(broadcastPlanSource).toContain(':playlist-id="currentPlaylistId"')
    expect(chatPanelSource).toContain('playlistId?: string | null')
    expect(chatPanelSource).toContain('watch(() => props.playlistId')
    expect(chatPanelSource).toContain('clearPendingRuntimeTaskState({ clearLayoutDraft: activePlaylistType.value === \'rotation\' })')
    expect(chatPanelSource).toContain('const clearPendingRuntimeTaskState')
    expect(chatPanelSource).toContain('pendingCommand.value = null')
    expect(chatPanelSource).toContain('pendingAtomicContext.value = null')
    expect(chatPanelSource).toContain('playlistContextChanged')
  })
})
