/**
 * 串联单节目数据
 */

// 节目素材状态
export type MaterialStatus = 'pending' | 'uploading' | 'ready' | 'error'

// 编单项接口
export interface ScheduleItem {
  id: string
  scheduleId?: string
  startTime: string
  endTime: string
  episodeName?: string
  indexingSheetCode?: string
  materialStatus?: MaterialStatus | 'uploading' | 'ready' | 'error' | 'pending'
  businessType?: 'recorded' | 'live' | 'ad' | 'program'
  programName?: string
  sourceType?: 'recorded' | 'live' | 'imported' | 'record'
  remark?: string
  sortOrder?: number
  duration?: number
  isReference?: boolean
  programCode?: string
  code18?: string
  materialId?: string
  materialName?: string
  isLocked?: boolean
  isUnlinkedProduct?: boolean
  isMaterialInfoEmpty?: boolean
  studio?: string
}

// 协同编单详情接口
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

// 频道选项
export interface ChannelOption {
  id: string
  name: string
}

// 频道选项列表
export const channelOptions: ChannelOption[] = [
  { id: 'news', name: '新闻综合' },
  { id: 'dragon', name: '东方卫视' },
  { id: 'finance', name: '第一财经' },
  { id: 'sports', name: '五星体育' },
  { id: 'doc', name: '纪实人文' },
  { id: 'cartoon', name: '哈哈炫动' },
]

// 素材状态文本映射
export const materialStatusText: Record<string, string> = {
  pending: '待上传',
  uploading: '上传中',
  ready: '已就绪',
  error: '上传失败',
}

// 素材状态类型映射
export const materialStatusType: Record<string, string> = {
  pending: 'info',
  uploading: 'warning',
  ready: 'success',
  error: 'danger',
}

// 时间转分钟数
export function timeToMinutes(time: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number)
  return hours * 60 + minutes + Math.floor(seconds / 60)
}

// 获取时间差（秒）
export function getTimeDiff(startTime: string, endTime: string): number {
  const [startHours = 0, startMinutes = 0, startSeconds = 0] = startTime.split(':').map(Number)
  const [endHours = 0, endMinutes = 0, endSeconds = 0] = endTime.split(':').map(Number)
  
  const startTotalSeconds = startHours * 3600 + startMinutes * 60 + startSeconds
  const endTotalSeconds = endHours * 3600 + endMinutes * 60 + endSeconds
  
  return endTotalSeconds - startTotalSeconds
}

// 生成唯一ID
export function generateId(): string {
  return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// 获取编单详情（模拟）
export function getScheduleDetail(id: string): CollaborativeScheduleDetail | null {
  return {
    id,
    name: '测试编单',
    channelId: 'news',
    channelName: '新闻综合',
    date: new Date().toISOString().split('T')[0],
    editor: '当前用户',
    editorId: 'current-user',
    status: 'draft',
    isLocked: false,
    items: [],
  }
}

// 生成导入的编单项（模拟）
export function generateImportedScheduleItems(): ScheduleItem[] {
  return []
}

// 节目类型选项
export const programTypeOptions = [
  { value: 'news', label: '新闻' },
  { value: 'weather', label: '天气' },
  { value: 'drama', label: '电视剧' },
  { value: 'variety', label: '综艺' },
  { value: 'movie', label: '电影' },
  { value: 'documentary', label: '纪录片' },
  { value: 'sports', label: '体育' },
  { value: 'education', label: '教育' },
  { value: 'ad', label: '广告' },
]

export function getProgramTypeName(type: string): string {
  const option = programTypeOptions.find((opt) => opt.value === type)
  return option?.label || type
}
