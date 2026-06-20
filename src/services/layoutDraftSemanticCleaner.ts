export interface LayoutDraftSemanticCleanOptions {
  stripLeadingPoliteCue?: boolean
}

export const cleanLayoutDraftActionNoise = (
  value: string,
  options: LayoutDraftSemanticCleanOptions = {},
): string => {
  let cleaned = value
    .replace(/^(?:按)?(?:纯电视频道|电视频道|频道编排|常规频道)[，,、\s]*/u, '')
    .replace(/[，,、；;。.!！?？\s]+$/u, '')
    .trim()

  if (options.stripLeadingPoliteCue) {
    cleaned = cleaned.replace(/^(?:请|帮我|帮忙|麻烦|给我|给)?/u, '')
  }

  cleaned = cleaned
    .replace(/^(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{1,2})?点(?:半)?)(?:到|至|-)(?:\d{1,2}:\d{2}|\d{1,2}(?::\d{1,2})?点(?:半)?)[，,、\s]*/u, '')
    .replace(/^(?:\d{1,2})(?:到|至|-)(?:\d{1,2})(?:点)?[，,、\s]*/u, '')
    .trim()

  for (let index = 0; index < 3; index += 1) {
    cleaned = cleaned
      .replace(/[，,、；;。.!！?？\s]*(?:生成|创建|新建|准备|制作|做成|做一版|做一份|来一版|来一份|做个|做一个|来个|排一版|排一份)?(?:轮播)?版面草案$/u, '')
      .replace(/[，,、；;。.!！?？\s]*(?:生成|创建|新建|准备|制作|做成|做一版|做一份|来一版|来一份|做个|做一个|来个|排一版|排一份)?草案$/u, '')
      .replace(/[，,、；;。.!！?？\s]*(?:生成|创建|新建|准备|制作|做成|做一版|做一份|来一版|来一份|做个|做一个|来个|排一版|排一份)?版面$/u, '')
      .replace(/[，,、；;。.!！?？\s]*(?:接昨天进度|接昨日进度|接昨天|接昨日|昨天进度|昨日进度|顺播|续播|继续播|接着播|顺着排)$/u, '')
      .replace(/[，,、；;。.!！?？\s]+$/u, '')
      .trim()
  }

  return cleaned
}

export const cleanLayoutDraftSemanticLabel = (
  value?: string,
  options: LayoutDraftSemanticCleanOptions = {},
): string | undefined => {
  if (!value?.trim()) return undefined
  const cleaned = cleanLayoutDraftActionNoise(value.trim(), options)
    .replace(/^(?:这个|当前|刚才的|原来的)?(?:版面草案|草案|版面)(?:不要了|不用了|取消掉|放弃|清掉|清除|删掉|删除)(?:，|,|、)?(?:重新|重做|再来|再做|改做|换成|改成|做成|来一版|做一版|排一版|做)?/u, '')
    .replace(/^(?:重新做|重新|重做|再来|再做|改做|换成|改成|做成|来一版|做一版|排一版|做)/u, '')
    .replace(/^(?:全部|都|统一|整体)+/u, '')
    .replace(/^(?:保留|保持)(?:现有|原有|当前)?(?:上午|中午|午间|下午|晚间|晚上|全天|整天|全日)?(?:节目|栏目)?/u, '')
    .replace(/^(?:补齐|补排|填充|补上|补满|只填|只补)(?:当前|剩余|所有)*(?:空窗|空缺|缺口|节目)?/u, '')
    .replace(/(?:节目|版面|内容)+$/u, '')
    .replace(/[，,、；;。.!！?？\s]+$/u, '')
    .trim()
  if (!cleaned || /^(?:(?:轮播)?版面草案|草案|版面|节目单|播单|轮播单|直播单)$/u.test(cleaned)) {
    return undefined
  }
  return cleaned
}

export const stripRestartSemanticDaypart = (value?: string): string | undefined =>
  value?.replace(/^(?:上午|中午|午间|下午|晚间|晚上|夜间|深夜|凌晨|全天|整天|全日)/u, '')
