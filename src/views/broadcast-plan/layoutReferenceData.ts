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
  dragon: [
    {
      id: 'ref-dragon-0600',
      time: '06:00',
      startTime: '06:00',
      endTime: '07:00',
      programName: '整点快报带',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
      remark: '版面参考：优先快讯、整点资讯',
    },
    {
      id: 'ref-dragon-0700',
      time: '07:00',
      startTime: '07:00',
      endTime: '09:30',
      programName: '早间资讯带',
      programType: 'news_magazine',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 9000,
      remark: '版面参考：优先看东方、早间民生资讯',
    },
    {
      id: 'ref-dragon-0930',
      time: '09:30',
      startTime: '09:30',
      endTime: '10:30',
      programName: '亲子成长带',
      programType: 'kids',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
      remark: '版面参考：少儿或亲子内容',
    },
    {
      id: 'ref-dragon-1030',
      time: '10:30',
      startTime: '10:30',
      endTime: '11:30',
      programName: '文旅人文带',
      programType: 'travel',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
      remark: '版面参考：旅行、文旅、人文',
    },
    {
      id: 'ref-dragon-1130',
      time: '11:30',
      startTime: '11:30',
      endTime: '12:00',
      programName: '国际资讯带',
      programType: 'news_magazine',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 1800,
      remark: '版面参考：国际资讯、ShanghaiEye 风格',
    },
    {
      id: 'ref-dragon-1230',
      time: '12:30',
      startTime: '12:30',
      endTime: '13:00',
      programName: '午间新闻带',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 1800,
      remark: '版面参考：午间新闻',
    },
    {
      id: 'ref-dragon-1300',
      time: '13:00',
      startTime: '13:00',
      endTime: '14:00',
      programName: '下午人文带',
      programType: 'documentary',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
      remark: '版面参考：人文、文化、考古',
    },
    {
      id: 'ref-dragon-1400',
      time: '14:00',
      startTime: '14:00',
      endTime: '15:30',
      programName: '下午剧场',
      programType: 'drama',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 5400,
      remark: '版面参考：经典剧场风格',
    },
    {
      id: 'ref-dragon-1530',
      time: '15:30',
      startTime: '15:30',
      endTime: '16:00',
      programName: '都市生活带',
      programType: 'lifestyle',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 1800,
      remark: '版面参考：城市生活服务',
    },
    {
      id: 'ref-dragon-1630',
      time: '16:30',
      startTime: '16:30',
      endTime: '17:30',
      programName: '都市娱乐带',
      programType: 'entertainment',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
      remark: '版面参考：都市娱乐、文化资讯',
    },
    {
      id: 'ref-dragon-1730',
      time: '17:30',
      startTime: '17:30',
      endTime: '18:00',
      programName: '健康生活带',
      programType: 'health',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 1800,
      remark: '版面参考：养生、医疗服务',
    },
    {
      id: 'ref-dragon-1830',
      time: '18:30',
      startTime: '18:30',
      endTime: '19:00',
      programName: '晚间新闻带',
      programType: 'news',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 1800,
      remark: '版面参考：晚间新闻',
    },
    {
      id: 'ref-dragon-1930',
      time: '19:30',
      startTime: '19:30',
      endTime: '21:00',
      programName: '黄金剧场',
      programType: 'drama',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 5400,
      remark: '版面参考：品质剧场风格',
    },
    {
      id: 'ref-dragon-2115',
      time: '21:15',
      startTime: '21:15',
      endTime: '22:00',
      programName: '晚间评论带',
      programType: 'commentary',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 2700,
      remark: '版面参考：评论、观察类内容',
    },
    {
      id: 'ref-dragon-2230',
      time: '22:30',
      startTime: '22:30',
      endTime: '23:30',
      programName: '深夜纪实带',
      programType: 'documentary',
      type: 'recorded',
      sourceType: 'recorded',
      duration: 3600,
      remark: '版面参考：纪实、人文内容',
    },
  ],
}

export function getLayoutReferenceByTime(startTime: string, endTime: string): LayoutReferenceItem[] {
  const startSeconds = timeToSeconds(startTime)
  const endSeconds = timeToSeconds(endTime)

  const allItems = Object.values(layoutReferenceData).flat()

  return allItems.filter((item) => {
    const itemSeconds = timeToSeconds(item.time)
    return itemSeconds >= startSeconds && itemSeconds < endSeconds
  })
}

function timeToSeconds(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return hours * 3600 + minutes * 60
}
