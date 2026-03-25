/**
 * 频道-演播室映射
 */

export interface Studio {
  id: string
  name: string
  capacity: number
  available: boolean
}

export interface ChannelStudioMapping {
  channelId: string
  channelName: string
  studios: Studio[]
}

const channelStudioMap: ChannelStudioMapping[] = [
  {
    channelId: 'ch1',
    channelName: '新闻综合频道',
    studios: [
      { id: 'studio-1', name: '一号演播室', capacity: 200, available: true },
      { id: 'studio-2', name: '二号演播室', capacity: 100, available: true },
      { id: 'studio-3', name: '三号演播室', capacity: 50, available: false },
    ],
  },
  {
    channelId: 'ch2',
    channelName: '都市频道',
    studios: [
      { id: 'studio-4', name: '四号演播室', capacity: 150, available: true },
      { id: 'studio-5', name: '五号演播室', capacity: 80, available: true },
    ],
  },
  {
    channelId: 'ch3',
    channelName: '经济频道',
    studios: [
      { id: 'studio-6', name: '六号演播室', capacity: 120, available: true },
      { id: 'studio-7', name: '七号演播室', capacity: 60, available: true },
    ],
  },
]

export function getStudiosByChannelId(channelId: string): Studio[] {
  const mapping = channelStudioMap.find((m) => m.channelId === channelId)
  return mapping?.studios || []
}

export function getChannelStudioMapping(): ChannelStudioMapping[] {
  return [...channelStudioMap]
}

export function isStudioAvailable(channelId: string, studioId: string): boolean {
  const studios = getStudiosByChannelId(channelId)
  const studio = studios.find((s) => s.id === studioId)
  return studio?.available || false
}
