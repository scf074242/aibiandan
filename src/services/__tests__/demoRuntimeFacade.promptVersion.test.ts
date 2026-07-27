import { describe, expect, it } from 'vitest'

import { DEMO_RUNTIME_FACADE_PROMPT_VERSION } from '@/services/runtime/demoRuntimeFacade'

describe('demoRuntimeFacade prompt 版本号管理', () => {
  /**
   * case c17-demo-runtime-version-exported
   * - expectedDecision: DEMO_RUNTIME_FACADE_PROMPT_VERSION 常量已导出且为 v1.0
   * - mustNotHappen: 常量缺失；常量值非 'v1.0'
   * - verification: DEMO_RUNTIME_FACADE_PROMPT_VERSION === 'v1.0'
   *
   * 说明：demoRuntimeFacade 内部存在 3 处 chat 调用（react 回复 / 普通回复 / 复合任务计划草稿），
   * 均为私有方法且依赖大量运行时上下文，难以通过公开 API 隔离触发；
   * 这里以常量导出 + 版本号断言作为门禁，保证 prompt 版本可追溯。
   */
  it('c17-demo-runtime-version-exported: DEMO_RUNTIME_FACADE_PROMPT_VERSION 导出且为 v1.0', () => {
    expect(DEMO_RUNTIME_FACADE_PROMPT_VERSION).toBe('v1.0')
  })
})
