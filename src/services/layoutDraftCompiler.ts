import type {
  GeneratedColumnDefinition,
  LayoutDraft,
  LayoutDraftStrategyProfile,
  LayoutDraftSpec,
  LayoutReference,
  LayoutSlot,
} from '@/types/orchestration'

export interface LayoutDraftCompileContext {
  channelId: string
  channelName: string
  date: string
  userIntent: string
  source: LayoutDraft['source']
  version?: number
  strategyProfile?: LayoutDraftStrategyProfile
}

const SOURCE_TO_COLUMN_SOURCE: Record<LayoutDraft['source'], GeneratedColumnDefinition['source']> = {
  generated: 'generated',
  uploaded: 'imported',
  channel_default: 'default',
}

const toIsoDateTime = (date: string, clock: string) => `${date}T${clock}+08:00`

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'segment'

export class LayoutDraftCompiler {
  compile(spec: LayoutDraftSpec, context: LayoutDraftCompileContext): LayoutDraft {
    const version = context.version ?? 1
    const layoutId = `layout-draft:${context.channelId}:${context.date}:v${version}`
    const columnSource = SOURCE_TO_COLUMN_SOURCE[context.source]

    const columns: GeneratedColumnDefinition[] = spec.segments.map((segment, index) => ({
      columnId: `runtime-column:${context.channelId}:${context.date}:${normalizeSlug(segment.label)}:${index + 1}`,
      columnName: segment.label,
      channelId: context.channelId,
      defaultProgramType: segment.programType,
      isSequential: segment.sequential,
      semanticLabel: segment.label,
      draftConstraintKind: segment.constraintKind,
      queryHints: segment.queryHints,
      selectionPolicy: segment.selectionPolicy,
      source: columnSource,
    }))

    const slots: LayoutSlot[] = spec.segments.map((segment, index) => ({
      id: segment.id ?? `${layoutId}:slot:${index + 1}`,
      channelId: context.channelId,
      startTime: toIsoDateTime(context.date, segment.startTime),
      endTime: toIsoDateTime(context.date, segment.endTime),
      columnId: columns[index]!.columnId,
    }))

    const layoutReference: LayoutReference = {
      id: layoutId,
      name: `${context.channelName}版面草案`,
      slots,
    }

    return {
      id: layoutId,
      channelId: context.channelId,
      date: context.date,
      version,
      source: context.source,
      userIntent: context.userIntent,
      strategyProfile: context.strategyProfile,
      coverage: spec.coverage,
      layoutReference,
      columns,
    }
  }
}

let globalLayoutDraftCompiler: LayoutDraftCompiler | null = null

export function getLayoutDraftCompiler(): LayoutDraftCompiler {
  if (!globalLayoutDraftCompiler) {
    globalLayoutDraftCompiler = new LayoutDraftCompiler()
  }
  return globalLayoutDraftCompiler
}
