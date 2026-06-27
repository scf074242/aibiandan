import type { ColumnDefinition } from '@/types/orchestration'

export type RetrievalConstraintKind = NonNullable<ColumnDefinition['draftConstraintKind']>

export interface ParsedDraftConstraintText {
  name: string
  kind?: RetrievalConstraintKind
}

export const parseDraftConstraintText = (value: string): ParsedDraftConstraintText => {
  const text = value.trim()
  const matched = text.match(/^(栏目|节目)\s*[:：=＝]\s*(.+)$/u)
  if (!matched) return { name: text }
  return {
    name: matched[2]?.trim() ?? text,
    kind: matched[1] === '栏目' ? 'column' : 'program',
  }
}

export const buildRetrievalConstraintKeyword = (
  label: string | undefined,
  kind: RetrievalConstraintKind = 'unspecified',
): string | null => {
  const normalizedLabel = label?.trim()
  if (!normalizedLabel) return null
  if (kind === 'column') return `栏目=${normalizedLabel}`
  if (kind === 'program') return `节目=${normalizedLabel}`
  return normalizedLabel
}

export const buildColumnRetrievalConstraintKeyword = (
  column: Pick<ColumnDefinition, 'columnName' | 'semanticLabel' | 'draftConstraintKind'> | undefined,
  defaultKind: RetrievalConstraintKind = 'column',
): string | null => {
  if (!column) return null
  return buildRetrievalConstraintKeyword(
    column.semanticLabel ?? column.columnName,
    column.draftConstraintKind ?? defaultKind,
  )
}

export const compileSearchKeywordsWithColumnConstraint = (
  searchKeywords: string[],
  column: Pick<ColumnDefinition, 'columnName' | 'semanticLabel' | 'draftConstraintKind'> | undefined,
  defaultKind: RetrievalConstraintKind = 'column',
): string[] => {
  const keywords = [...searchKeywords]
  const constraintKeyword = buildColumnRetrievalConstraintKeyword(column, defaultKind)
  if (constraintKeyword) {
    keywords.unshift(constraintKeyword)
  }
  return Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)))
}

export const resolveFormalOrchestrationSearchKeywords = (userInput: string): string[] => {
  const compact = userInput.replace(/\s+/g, '')
  const isOnlyGapFill = /(补齐|补排|补全|填充|填满).*(当前)?(所有)?(空窗|空缺|缺口)|补齐当前所有空窗/.test(compact)
    && !/(栏目|节目|剧场|新闻|电视剧|综艺|专题|少儿|动画|纪录|体育|看东方|东方|ShanghaiEye)/i.test(compact)
  if (isOnlyGapFill) return []

  let text = compact
    .replace(/\d{1,2}(?:点|时|:|：)(?:\d{1,2}分?)?(?:到|至|-|—|~)\d{1,2}(?:点|时|:|：)(?:\d{1,2}分?)?/g, '')
    .replace(/\d{1,2}点(?:半)?/g, '')
    .replace(/(上午|中午|午间|下午|晚间|晚上|夜间|黄金时段|黄金档|七点档|八点档)/g, '')
    .replace(/(帮我|请|把|将|当前|所有|全部|空窗|空缺|缺口|电视播单|轮播单|播单|正式|进行|开始|继续)/g, '')
    .replace(/(参考|参照|依据|基于|按照|使用|用|草案|版面)/g, '')
    .replace(/(编排|安排|排入|排播|排满|铺满|补排|补齐|填充|改成|统一成|调整为|主打|为主|换成|生成)/g, '')
    .replace(/[，。；、,.!！?？]/g, '')
    .trim()

  if (!text) return []
  const explicitColumn = text.match(/^栏目\s*[:：=＝]?\s*(.+)$/u) ?? text.match(/^(.+?)栏目$/u)
  if (explicitColumn?.[1]) {
    const label = explicitColumn[1].replace(/^(的|为|成)/, '').trim()
    const keyword = buildRetrievalConstraintKeyword(label, 'column')
    return keyword ? [keyword] : []
  }
  const explicitProgram = text.match(/^节目\s*[:：=＝]?\s*(.+)$/u) ?? text.match(/^(.+?)节目$/u)
  if (explicitProgram?.[1]) {
    const label = explicitProgram[1].replace(/^(的|为|成)/, '').trim()
    const keyword = buildRetrievalConstraintKeyword(label, 'program')
    return keyword ? [keyword] : []
  }
  text = text.replace(/^(为|成|的)/, '').trim()
  return text ? [text] : []
}
