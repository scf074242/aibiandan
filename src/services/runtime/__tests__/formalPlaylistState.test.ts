import { describe, expect, it } from 'vitest'

import { buildFormalPlaylistVersion } from '../formalPlaylistState'

const roundTripVersionCase = {
  id: 'formal-playlist-version-time-representation-round-trip',
  userInput: '确认继续执行等待中的正式编排动作',
  expectedDecision: '同一播单经过原子快照、页面展示、运行时输入往返后仍使用同一版本',
  mustNotHappen: '仅因完整日期时间被页面表示为时钟时间就判定播单版本冲突',
  verification: '带日期的 +08:00 时间与同一时钟值的 HH:mm:ss 生成相同版本，真实时间变化生成不同版本',
} as const

describe('formalPlaylistState versioning', () => {
  it(roundTripVersionCase.id, () => {
    const atomicSnapshot = [{
      id: 'schedule-1',
      programCode: 'P001',
      programName: '新闻直播间',
      startTime: '2026-07-21T09:00:00+08:00',
      endTime: '2026-07-21T10:00:00+08:00',
      duration: 3600,
      programType: 'program',
    }]
    const pageRoundTrip = [{
      ...atomicSnapshot[0],
      startTime: '09:00:00',
      endTime: '10:00:00',
    }]
    const changedSchedule = [{
      ...pageRoundTrip[0],
      endTime: '10:01:00',
      duration: 3660,
    }]

    expect(buildFormalPlaylistVersion(pageRoundTrip)).toBe(buildFormalPlaylistVersion(atomicSnapshot))
    expect(buildFormalPlaylistVersion(changedSchedule)).not.toBe(buildFormalPlaylistVersion(atomicSnapshot))
    expect(roundTripVersionCase.expectedDecision).toContain('同一版本')
    expect(roundTripVersionCase.mustNotHappen).toContain('版本冲突')
    expect(roundTripVersionCase.verification).toContain('真实时间变化')
  })
})
