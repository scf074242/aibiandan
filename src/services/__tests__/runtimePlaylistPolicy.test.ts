import { describe, expect, it } from 'vitest'

import { deriveRuntimePlaylistPolicy } from '@/services/runtime/playlistPolicy'

describe('runtime playlist policy', () => {
  it('derives fixed time-slot semantics for TV playlists', () => {
    const policy = deriveRuntimePlaylistPolicy({ playlistType: 'tv' })

    expect(policy).toMatchObject({
      playlistType: 'tv',
      placementMode: 'fixed_time_slot',
      replaceMode: 'preserve_slot',
      deleteMode: 'leave_gap',
      gapPolicy: 'preserve_gaps',
      durationMode: 'fixed_clock',
    })
    expect(policy.validationFocus).toContain('空窗')
  })

  it('derives continuous queue semantics for rotation playlists', () => {
    const policy = deriveRuntimePlaylistPolicy({
      playlistType: 'rotation',
      rotationStrategy: 'trending',
      rotationDurationSeconds: 3 * 3600,
    })

    expect(policy).toMatchObject({
      playlistType: 'rotation',
      placementMode: 'continuous_sequence',
      replaceMode: 'compact_sequence',
      deleteMode: 'compact_sequence',
      gapPolicy: 'compact_sequence',
      durationMode: 'target_total_duration',
      rotationStrategy: 'trending',
      targetDurationSeconds: 3 * 3600,
    })
    expect(policy.validationFocus).toContain('总时长差额')
  })
})
