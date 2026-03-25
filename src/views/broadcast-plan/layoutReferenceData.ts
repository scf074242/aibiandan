/**
 * 版面参考数据
 */
export interface LayoutReferenceItem {
  id: string
  time: string
  programName: string
  programType: string
  duration: number
  code18?: string
  sourceType?: 'recorded' | 'live' | 'imported'
  remark?: string
  startTime?: string
  endTime?: string
  type?: string
}

export const layoutReferenceData: Record<string, LayoutReferenceItem[]> = {
  news: [
    {
      id: 'ref-1',
      time: '06:00',
      startTime: '06:00',
      endTime: '07:00',
      programName: '早间新闻',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
    },
    {
      id: 'ref-2',
      time: '07:00',
      startTime: '07:00',
      endTime: '07:15',
      programName: '天气预报',
      programType: 'weather',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 900,
    },
    {
      id: 'ref-3',
      time: '07:15',
      startTime: '07:15',
      endTime: '08:15',
      programName: '朝闻天下',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 4500,
    },
    {
      id: 'ref-4',
      time: '08:15',
      startTime: '08:15',
      endTime: '08:50',
      programName: '新闻联播',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 2700,
    },
    {
      id: 'ref-5',
      time: '08:50',
      startTime: '08:50',
      endTime: '09:20',
      programName: '焦点访谈',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 1800,
    },
  ],
  dragon: [
    {
      id: 'ref-6',
      time: '06:00',
      startTime: '06:00',
      endTime: '07:00',
      programName: '东方新闻',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
    },
    {
      id: 'ref-7',
      time: '07:00',
      startTime: '07:00',
      endTime: '08:00',
      programName: '东方看东方',
      programType: 'variety',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
    },
  ],
  finance: [
    {
      id: 'ref-8',
      time: '06:00',
      startTime: '06:00',
      endTime: '07:00',
      programName: '财经早知道',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
    },
  ],
  sports: [
    {
      id: 'ref-9',
      time: '06:00',
      startTime: '06:00',
      endTime: '08:00',
      programName: '体育晨报',
      programType: 'sports',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 7200,
    },
  ],
  doc: [
    {
      id: 'ref-10',
      time: '06:00',
      startTime: '06:00',
      endTime: '07:00',
      programName: '纪录片展播',
      programType: 'documentary',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
    },
  ],
  cartoon: [
    {
      id: 'ref-11',
      time: '06:00',
      startTime: '06:00',
      endTime: '07:00',
      programName: '动画剧场',
      programType: 'drama',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
    },
  ],
}

export function getLayoutReferenceByTime(startTime: string, endTime: string): LayoutReferenceItem[] {
  const startSeconds = timeToSeconds(startTime)
  const endSeconds = timeToSeconds(endTime)

  const allItems: LayoutReferenceItem[] = []
  Object.values(layoutReferenceData).forEach((items) => {
    allItems.push(...items)
  })

  return allItems.filter((item) => {
    const itemSeconds = timeToSeconds(item.time)
    return itemSeconds >= startSeconds && itemSeconds < endSeconds
  })
}

function timeToSeconds(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * 3600 + minutes * 60
}
