import { demoChannels, demoScheduleDetail, demoScheduleItems } from '@/mock/demoData'

export type MaterialStatus = 'pending' | 'uploading' | 'ready' | 'error'
export type BusinessType = 'recorded' | 'live' | 'ad' | 'program' | 'promo' | string
export type SourceType = 'recorded' | 'record' | 'live' | 'imported' | string

export interface ScheduleItem {
  id: string
  scheduleId?: string
  startTime: string
  endTime: string
  programType?: string
  instanceName?: string
  indexingSheetCode?: string
  materialStatus?: MaterialStatus | string
  businessType?: BusinessType
  programName?: string
  sourceType?: SourceType
  remark?: string
  sortOrder?: number
  duration?: number
  isReference?: boolean
  programCode?: string
  code18?: string
  materialId?: string
  materialName?: string
  keySlot?: string
  isLocked?: boolean
  isUnlinkedProduct?: boolean
  isMaterialInfoEmpty?: boolean
  studio?: string
  relativeStart?: string
  playLength?: string
  isOverdue?: boolean
  omniBroadcastRight?: string
  thirdReviewDate?: string
  lastPlayableTime?: string
  rebroadcastReauditDate?: string
}

export interface CollaborativeScheduleDetail {
  id: string
  name: string
  channelId: string
  channelName: string
  date: string
  editor: string
  editorId: string
  status: 'draft' | 'pending' | 'approved' | 'broadcasting' | 'completed'
  isLocked: boolean
  items: ScheduleItem[]
}

export interface ChannelOption {
  id: string
  name: string
}

export const channelOptions: ChannelOption[] = demoChannels.map((channel) => ({ id: channel.id, name: channel.name }))

export const materialStatusText: Record<string, string> = {
  pending: '待上传',
  uploading: '上传中',
  ready: '已就绪',
  error: '上传失败',
}

export const materialStatusType: Record<string, string> = {
  pending: 'info',
  uploading: 'warning',
  ready: 'success',
  error: 'danger',
}

export function timeToMinutes(time: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = String(time).split(':').map(Number)
  return hours * 60 + minutes + Math.floor(seconds / 60)
}

export function getTimeDiff(startTime: string, endTime: string): number {
  const [startHours = 0, startMinutes = 0, startSeconds = 0] = String(startTime).split(':').map(Number)
  const [endHours = 0, endMinutes = 0, endSeconds = 0] = String(endTime).split(':').map(Number)
  const startTotalSeconds = startHours * 3600 + startMinutes * 60 + startSeconds
  const endTotalSeconds = endHours * 3600 + endMinutes * 60 + endSeconds
  return Math.max(0, endTotalSeconds - startTotalSeconds)
}

export function generateId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function getScheduleDetail(id: string): CollaborativeScheduleDetail | null {
  return demoScheduleDetail(id)
}

export function generateImportedScheduleItems(): ScheduleItem[] {
  return demoScheduleItems.map((item) => ({ ...item }))
}

export const programTypeOptions = [
  { value: 'news', label: '新闻' },
  { value: 'news_magazine', label: '新闻资讯' },
  { value: 'news_commentary', label: '新闻评论' },
  { value: 'commentary', label: '评论' },
  { value: 'livelihood', label: '民生' },
  { value: 'law', label: '法治' },
  { value: 'health', label: '健康' },
  { value: 'weather', label: '天气' },
  { value: 'drama', label: '电视剧' },
  { value: 'entertainment', label: '娱乐' },
  { value: 'variety', label: '综艺' },
  { value: 'movie', label: '电影' },
  { value: 'documentary', label: '纪录片' },
  { value: 'sports', label: '体育' },
  { value: 'education', label: '教育' },
  { value: 'kids', label: '少儿' },
  { value: 'travel', label: '旅游' },
  { value: 'lifestyle', label: '生活' },
  { value: 'promo', label: '宣传片' },
  { value: 'filler', label: '填充' },
  { value: 'ad', label: '广告' },
]

export function getProgramTypeName(type: string): string {
  const option = programTypeOptions.find((item) => item.value === type)
  return option?.label ?? type
}
