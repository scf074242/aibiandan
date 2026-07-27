import type { OrchestrationCommand, ScheduleItemSnapshot } from '@/types/orchestration'
import type {
  RuntimeExecutePendingCommandInput,
  RuntimeExecutedResult,
  RuntimeScheduleItem,
} from './schedulingAgentRuntimeFacade'

export interface FormalPlaylistSnapshot {
  version: string
  items: RuntimeScheduleItem[]
  itemCount: number
  updatedAt: string
  source: 'foreground' | 'write_result' | 'server_recovery'
}

export interface FormalPlaylistPatch {
  type: 'formal_playlist_patch'
  previousVersion?: string
  nextVersion: string
  itemCount: number
  changedItemIds: string[]
  affectedTimeRanges?: { start: string; end: string }[]
  source: 'formal-playlist-write-boundary'
}

export interface FormalPlaylistWriteArtifacts {
  snapshot: FormalPlaylistSnapshot
  patch: FormalPlaylistPatch
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
)

const isRuntimeScheduleItem = (value: unknown): value is RuntimeScheduleItem => {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.startTime === 'string'
    && typeof value.endTime === 'string'
}

const normalizeItems = (items: RuntimeScheduleItem[]): RuntimeScheduleItem[] => (
  items
    .filter(isRuntimeScheduleItem)
    .map((item) => ({ ...item }))
    .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id))
)

const hashText = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const normalizeVersionTime = (value: string): string => {
  const match = /(?:T|^)(\d{2}:\d{2})(?::(\d{2}))?/.exec(value.trim())
  return match ? `${match[1]}:${match[2] ?? '00'}` : value.trim()
}

export const buildFormalPlaylistVersion = (items: RuntimeScheduleItem[]): string => {
  const stablePayload = normalizeItems(items).map((item) => [
    item.id,
    item.programCode ?? '',
    item.programName ?? '',
    normalizeVersionTime(item.startTime),
    normalizeVersionTime(item.endTime),
    String(item.duration ?? ''),
    item.programType ?? '',
  ].join('|')).join('\n')
  return `formal_${hashText(stablePayload)}`
}

export const buildFormalPlaylistSnapshot = (
  items: RuntimeScheduleItem[],
  source: FormalPlaylistSnapshot['source'] = 'foreground',
  updatedAt = new Date().toISOString(),
): FormalPlaylistSnapshot => {
  const normalizedItems = normalizeItems(items)
  return {
    version: buildFormalPlaylistVersion(normalizedItems),
    items: normalizedItems,
    itemCount: normalizedItems.length,
    updatedAt,
    source,
  }
}

const collectItemsFromValue = (value: unknown): RuntimeScheduleItem[] => {
  if (Array.isArray(value)) return value.filter(isRuntimeScheduleItem)
  if (!isRecord(value)) return []
  const directItems = Array.isArray(value.items) ? value.items.filter(isRuntimeScheduleItem) : []
  const item = isRuntimeScheduleItem(value.item) ? [value.item] : []
  const newItem = isRuntimeScheduleItem(value.newItem) ? [value.newItem] : []
  const addedItems = Array.isArray(value.addedItems) ? value.addedItems.filter(isRuntimeScheduleItem) : []
  return [...directItems, ...item, ...newItem, ...addedItems]
}

const toTimeMs = (value: string): number => {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : NaN
}

const addSeconds = (value: string, seconds: number): string => {
  const startMs = toTimeMs(value)
  if (!Number.isFinite(startMs)) return value
  return new Date(startMs + seconds * 1000).toISOString().replace('.000Z', '')
}

const resolveDurationSeconds = (item: RuntimeScheduleItem): number => {
  if (typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration >= 0) {
    return item.duration
  }
  const startMs = toTimeMs(item.startTime)
  const endMs = toTimeMs(item.endTime)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  return Math.max(0, Math.floor((endMs - startMs) / 1000))
}

export const buildScheduleItemSnapshotsFromFormalPlaylist = (
  snapshot: FormalPlaylistSnapshot,
): ScheduleItemSnapshot[] => (
  snapshot.items.map((item, index) => ({
    id: item.id,
    programCode: item.programCode ?? item.id,
    programName: item.programName ?? item.id,
    startTime: item.startTime,
    endTime: item.endTime,
    duration: resolveDurationSeconds(item),
    programType: item.programType ?? 'unknown',
    sequence: index + 1,
  }))
)

const applyCommandToItems = (
  items: RuntimeScheduleItem[],
  command: OrchestrationCommand,
  resultItems: RuntimeScheduleItem[],
): RuntimeScheduleItem[] => {
  if (command.action === 'delete') {
    const itemId = 'data' in command && isRecord(command.data) && typeof command.data.itemId === 'string'
      ? command.data.itemId
      : null
    return itemId ? items.filter((item) => item.id !== itemId) : items
  }

  if (command.action === 'move') {
    const itemId = 'data' in command && isRecord(command.data) && typeof command.data.itemId === 'string'
      ? command.data.itemId
      : null
    const newStartTime = 'data' in command && isRecord(command.data) && typeof command.data.newStartTime === 'string'
      ? command.data.newStartTime
      : null
    if (!itemId || !newStartTime) return items
    return items.map((item) => {
      if (item.id !== itemId) return item
      const duration = item.duration ?? Math.max(0, (toTimeMs(item.endTime) - toTimeMs(item.startTime)) / 1000)
      return {
        ...item,
        startTime: newStartTime,
        endTime: Number.isFinite(duration) ? addSeconds(newStartTime, duration) : item.endTime,
      }
    })
  }

  if (command.action === 'insert') {
    if (!resultItems.length) return items
    const resultIds = new Set(resultItems.map((item) => item.id))
    return [
      ...items.filter((item) => !resultIds.has(item.id)),
      ...resultItems,
    ]
  }

  if (command.action === 'replace') {
    const itemId = 'data' in command && isRecord(command.data) && typeof command.data.itemId === 'string'
      ? command.data.itemId
      : null
    if (!itemId || !resultItems.length) return items
    const replacement = resultItems[0]
    if (!replacement) return items
    return items.map((item) => item.id === itemId ? { ...replacement, id: replacement.id || item.id } : item)
  }

  return items
}

const resolveChangedItemIds = (
  before: RuntimeScheduleItem[],
  after: RuntimeScheduleItem[],
): string[] => {
  const beforeById = new Map(before.map((item) => [item.id, JSON.stringify(item)]))
  const afterById = new Map(after.map((item) => [item.id, JSON.stringify(item)]))
  const ids = new Set([...beforeById.keys(), ...afterById.keys()])
  return [...ids].filter((id) => beforeById.get(id) !== afterById.get(id)).sort()
}

export const buildFormalPlaylistWriteArtifacts = (
  input: RuntimeExecutePendingCommandInput,
  result: RuntimeExecutedResult,
  previousSnapshot: FormalPlaylistSnapshot | null | undefined,
): FormalPlaylistWriteArtifacts | null => {
  if (!result.success || !previousSnapshot) return null
  const resultItems = collectItemsFromValue(result.data)
  const commands = input.pendingCommand.commands?.length
    ? input.pendingCommand.commands
    : [input.pendingCommand.command]
  const nextItems = commands.reduce(
    (items, command) => applyCommandToItems(items, command, resultItems),
    previousSnapshot.items,
  )
  const snapshot = buildFormalPlaylistSnapshot(nextItems, 'write_result')
  const changedItemIds = resolveChangedItemIds(previousSnapshot.items, snapshot.items)
  return {
    snapshot,
    patch: {
      type: 'formal_playlist_patch',
      previousVersion: previousSnapshot.version,
      nextVersion: snapshot.version,
      itemCount: snapshot.itemCount,
      changedItemIds,
      affectedTimeRanges: result.affectedTimeRanges,
      source: 'formal-playlist-write-boundary',
    },
  }
}
