import { describe, expect, it } from 'vitest'

import {
  parseAtomicClockExpression,
  parseAtomicClockExpressions,
  parseAtomicTimeRange,
} from '@/services/atomicTimeParser'

describe('atomicTimeParser', () => {
  it.each([
    ['九点', '09:00:00', '九点'],
    ['九点半', '09:30:00', '九点半'],
    ['九点二十', '09:20:00', '九点二十'],
    ['两点一刻那档节目', '14:15:00', '两点一刻'],
    ['两点三刻那档节目', '14:45:00', '两点三刻'],
    ['两点半那档节目', '14:30:00', '两点半'],
    ['凌晨两点的重播节目', '02:00:00', '两点'],
  ])('能解析中文时间点: %s', (input, targetTime, matchedText) => {
    expect(parseAtomicClockExpression(input)).toMatchObject({
      targetTime,
      matchedText,
    })
  })

  it.each([
    ['九点到十二点', { start: '09:00:00', end: '12:00:00' }],
    ['两点半到三点做社区服务提醒', { start: '14:30:00', end: '15:00:00' }],
    ['两点一刻到三点做社区服务提醒', { start: '14:15:00', end: '15:00:00' }],
    ['两点三刻到三点做发布会直播', { start: '14:45:00', end: '15:00:00' }],
    ['凌晨两点到三点做新闻重播', { start: '02:00:00', end: '03:00:00' }],
    ['14:00到15:00的轮播单', { start: '14:00:00', end: '15:00:00' }],
  ])('能解析中文时间段: %s', (input, expected) => {
    expect(parseAtomicTimeRange(input)).toEqual(expected)
  })

  it('能返回多处时间提示供上下文使用', () => {
    expect(parseAtomicClockExpressions('九点到十二点再看两点半那档').map((item) => item.targetTime)).toEqual([
      '09:00:00',
      '12:00:00',
      '14:30:00',
    ])
  })

  it('不会把垫一点里的数量副词误判为时间点', () => {
    expect(parseAtomicClockExpression('发布会开播前垫一点现场导视')).toBeNull()
  })
})
