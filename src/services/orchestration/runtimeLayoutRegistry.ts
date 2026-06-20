import {
  getOrchestrationDemoColumn,
  getOrchestrationDemoLayout,
  getOrchestrationDemoProgramsByColumn,
  getOrchestrationDemoInstancesByColumn,
  orchestrationDemoProgramDefinitions,
  orchestrationDemoProgramInstances,
} from '@/mock/orchestrationMock'
import type {
  ColumnDefinition,
  LayoutReference,
  ProgramDefinition,
  ProgramInstance,
} from '@/types/orchestration'
import type { LayoutTemplateMode, ImportedLayoutPackage } from '@/services/layoutImportService'

export interface RuntimeLayoutEntry {
  sourceFileName: string
  channelId: string
  date: string
  effectiveFrom?: string
  effectiveTo?: string
  version?: number
  templateMode?: LayoutTemplateMode
  matchedSheetName?: string
  matchedWeekday?: ImportedLayoutPackage['matchedWeekday']
  matchedWeekdayLabel?: string
  matchedColumnLabel?: string
  importedAt: string
  warnings: string[]
  layoutReference: LayoutReference
  columns: ColumnDefinition[]
}

const runtimeLayouts = new Map<string, RuntimeLayoutEntry>()
const runtimeColumns = new Map<string, ColumnDefinition>()

const buildLayoutKey = (channelId: string, date: string) => `${channelId}_${date}`
const normalizeDate = (date: string) => date.slice(0, 10)

const isEntryEffectiveForDate = (entry: RuntimeLayoutEntry, date: string) => {
  const target = normalizeDate(date)
  if (entry.effectiveFrom && target < normalizeDate(entry.effectiveFrom)) return false
  if (entry.effectiveTo && target > normalizeDate(entry.effectiveTo)) return false
  return Boolean(entry.effectiveFrom || entry.effectiveTo)
}

const isRuntimeColumnId = (columnId: string) => columnId.startsWith('runtime-column:')

const collectChannelProgramDefinitions = (channelId: string): ProgramDefinition[] =>
  orchestrationDemoProgramDefinitions.filter((program) => {
    const column = getOrchestrationDemoColumn(program.columnId)
    return column?.channelId === channelId
  })

const collectProgramInstancesByProgramIds = (programIds: Set<string>): ProgramInstance[] =>
  orchestrationDemoProgramInstances.filter((instance) => programIds.has(instance.programId))

export function setRuntimeLayout(entry: Omit<RuntimeLayoutEntry, 'importedAt'>): RuntimeLayoutEntry {
  const nextEntry: RuntimeLayoutEntry = {
    ...entry,
    importedAt: new Date().toISOString(),
  }
  const key = buildLayoutKey(entry.channelId, entry.date)
  const previous = runtimeLayouts.get(key)
  if (previous) {
    previous.columns.forEach((column) => {
      if (isRuntimeColumnId(column.columnId)) {
        runtimeColumns.delete(column.columnId)
      }
    })
  }

  runtimeLayouts.set(key, nextEntry)
  nextEntry.columns.forEach((column) => {
    if (isRuntimeColumnId(column.columnId)) {
      runtimeColumns.set(column.columnId, column)
    }
  })

  return nextEntry
}

export function getRuntimeLayoutEntry(channelId: string, date: string): RuntimeLayoutEntry | null {
  const exact = runtimeLayouts.get(buildLayoutKey(channelId, date))
  if (exact) return exact

  return [...runtimeLayouts.values()]
    .filter((entry) => entry.channelId === channelId && isEntryEffectiveForDate(entry, date))
    .sort((a, b) => {
      const versionDiff = (b.version ?? 0) - (a.version ?? 0)
      if (versionDiff !== 0) return versionDiff
      return b.importedAt.localeCompare(a.importedAt)
    })[0] ?? null
}

export function hasRuntimeLayoutEntry(channelId: string, date: string): boolean {
  return Boolean(getRuntimeLayoutEntry(channelId, date))
}

export function getEffectiveLayoutReference(channelId: string, date: string): LayoutReference | null {
  return getRuntimeLayoutEntry(channelId, date)?.layoutReference ?? getOrchestrationDemoLayout(channelId, date)
}

export function clearRuntimeLayout(channelId: string, date: string): void {
  const key = buildLayoutKey(channelId, date)
  const previous = runtimeLayouts.get(key)
  if (!previous) return

  previous.columns.forEach((column) => {
    if (isRuntimeColumnId(column.columnId)) {
      runtimeColumns.delete(column.columnId)
    }
  })
  runtimeLayouts.delete(key)
}

export function getEffectiveColumnDefinition(columnId: string): ColumnDefinition | undefined {
  return runtimeColumns.get(columnId) ?? getOrchestrationDemoColumn(columnId)
}

export function getEffectiveProgramsByColumn(channelId: string, columnId: string): ProgramDefinition[] {
  const runtimeColumn = runtimeColumns.get(columnId)
  if (!runtimeColumn) {
    return getOrchestrationDemoProgramsByColumn(channelId, columnId)
  }

  const channelPrograms = collectChannelProgramDefinitions(channelId)
  if (!runtimeColumn.defaultProgramType) {
    return channelPrograms
  }

  return channelPrograms.filter((program) => program.programType === runtimeColumn.defaultProgramType)
}

export function getEffectiveInstancesByColumn(channelId: string, columnId: string): ProgramInstance[] {
  const runtimeColumn = runtimeColumns.get(columnId)
  if (!runtimeColumn) {
    return getOrchestrationDemoInstancesByColumn(channelId, columnId)
  }

  const programIds = new Set(
    getEffectiveProgramsByColumn(channelId, columnId).map((program) => program.programId),
  )
  return collectProgramInstancesByProgramIds(programIds)
}
