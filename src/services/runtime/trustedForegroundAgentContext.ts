import { getDataService } from '@/services/orchestration/dataService'
import type { ScheduleSummary } from '@/types/orchestration'
import type { RuntimeSubmitInput } from './demoRuntimeFacade'
import {
  buildForegroundAgentContextPackage,
  type ForegroundAgentContextPackage,
} from './foregroundAgentContextPackage'

export async function buildTrustedForegroundAgentContext(
  input: RuntimeSubmitInput,
): Promise<ForegroundAgentContextPackage> {
  let historySchedules: ScheduleSummary[] = []
  let historySourceAvailable = input.scheduleState.playlistType === 'none'
  if (input.scheduleState.playlistType !== 'none') {
    try {
      historySchedules = await getDataService().getHistorySchedules(
        input.scheduleState.channelId,
        input.scheduleState.date,
      )
      historySourceAvailable = true
    } catch {
      historySourceAvailable = false
    }
  }

  return buildForegroundAgentContextPackage({
    latestUserInput: input.userInput,
    scheduleState: input.scheduleState,
    currentSchedule: input.currentSchedule,
    currentLayoutDraft: input.currentLayoutDraft,
    pendingAtomicContext: input.pendingAtomicContext,
    activeReactTaskRun: input.activeReactTaskRun,
    historySchedules,
    historySourceAvailable,
  })
}
