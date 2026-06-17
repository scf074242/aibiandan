import { describe, expect, it } from 'vitest'

import { parseAtomicOffset } from '@/services/atomicOffsetParser'

describe('parseAtomicOffset', () => {
  it.each([
    ['后移五分钟', { direction: 'forward', offsetSeconds: 300 }],
    ['整体后移十五分钟', { direction: 'forward', offsetSeconds: 900 }],
    ['提前十分钟', { direction: 'backward', offsetSeconds: 600 }],
    ['往前挪二十分钟', { direction: 'backward', offsetSeconds: 1200 }],
    ['后移半个小时', { direction: 'forward', offsetSeconds: 1800 }],
    ['前移半小时', { direction: 'backward', offsetSeconds: 1800 }],
    ['延后两个小时', { direction: 'forward', offsetSeconds: 7200 }],
    ['推迟三十分钟', { direction: 'forward', offsetSeconds: 1800 }],
    ['推后1小时', { direction: 'forward', offsetSeconds: 3600 }],
    ['延迟15分钟', { direction: 'forward', offsetSeconds: 900 }],
    ['往后挪1小时', { direction: 'forward', offsetSeconds: 3600 }],
    ['向后移动1小时', { direction: 'forward', offsetSeconds: 3600 }],
    ['向前移动10分钟', { direction: 'backward', offsetSeconds: 600 }],
  ])('解析中文和数字时间幅度：%s', (input, expected) => {
    expect(parseAtomicOffset(input)).toEqual(expected)
  })
})
