import type { FixedItem } from '@/types/orchestration'
import type { CollaborativeScheduleDetail, ScheduleItem } from '@/views/broadcast-plan/scheduleData'
import {
  getOrchestrationDemoFixedItems,
  orchestrationDemoBaseDate,
  orchestrationDemoChannels,
  orchestrationDemoRuntimeDate,
} from './orchestrationMock'

export interface DemoChannel {
  id: string
  name: string
  code: string
  timeZone: string
  defaultStartTime: string
  defaultEndTime: string
}

export interface DemoAtomicScenario {
  id: string
  title: string
  description: string
  itemIds: string[]
}

export const demoBaseDate = orchestrationDemoBaseDate
export const demoRuntimeDate = orchestrationDemoRuntimeDate

export const demoChannels: DemoChannel[] = orchestrationDemoChannels.map((channel) => ({
  id: channel.id,
  name: channel.name,
  code: channel.code,
  timeZone: channel.timeZone,
  defaultStartTime: channel.defaultStartTime,
  defaultEndTime: channel.defaultEndTime,
}))

export const demoScheduleItems: ScheduleItem[] = []

export const demoAtomicScenarios: DemoAtomicScenario[] = []

export const demoScheduleDetail = (id: string): CollaborativeScheduleDetail => ({
  id,
  name: '示例编单',
  channelId: 'dragon',
  channelName: '东方卫视',
  date: demoBaseDate,
  editor: '当前用户',
  editorId: 'current-user',
  status: 'draft',
  isLocked: false,
  items: demoScheduleItems.map((item) => ({ ...item })),
})

export function getDemoFixedItems(channelId: string, date: string): FixedItem[] {
  return getOrchestrationDemoFixedItems(channelId, date)
}
