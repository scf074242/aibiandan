# AI 智能编排功能集成计划

> **版本**: v1.0  
> **日期**: 2026-03-24  
> **目标**: 将已开发的 LLM 智能编排组件集成到 create.vue 页面中

---

## 一、现状分析

### 1.1 已开发的组件

**核心服务**:
- ✅ `src/services/llm/llmClient.ts` - LLM 客户端
- ✅ `src/services/llm/llmConfig.ts` - 配置管理
- ✅ `src/services/llm/promptBuilder.ts` - Prompt 构建器
- ✅ `src/services/llm/contextBuilder.ts` - 上下文构建
- ✅ `src/services/llm/responseParser.ts` - 响应解析
- ✅ `src/services/orchestrator.ts` - 编排调度器
- ✅ `src/services/commandExecutor.ts` - 命令执行器

**UI 组件**:
- ✅ `src/components/llm/LLMConfigPanel.vue` - LLM 配置面板
- ✅ `src/components/orchestration/OrchestrationProgress.vue` - 编排进度面板
- ✅ `src/components/dialogue/ChatPanel.vue` - AI 对话面板

**组合式函数**:
- ✅ `src/composables/useOrchestrator.ts` - 编排组合式函数

### 1.2 待集成到 create.vue

**现有 create.vue 问题**:
- ❌ 缺少类型定义导入
- ❌ 缺少组件引用
- ❌ 缺少 AI 编排按钮
- ❌ 缺少编排抽屉/对话框
- ❌ 缺少对话面板

---

## 二、集成步骤

### 步骤 1：创建必要的类型定义文件

**任务 1.1**: 创建 scheduleData.ts
**文件**: `src/views/broadcast-plan/scheduleData.ts`
```typescript
// 节目数据接口
export interface ScheduleItemData {
  id: string
  programCode: string
  programName: string
  startTime: string
  endTime: string
  duration: number
  programType: string
  sortOrder: number
  // ... 其他字段
}

// 导出模拟数据
export const scheduleData = [...]
```

**任务 1.2**: 创建 layoutReferenceData.ts
**文件**: `src/views/broadcast-plan/layoutReferenceData.ts`
```typescript
// 版面参考数据
export interface LayoutReferenceItem {
  id: string
  time: string
  programName: string
  programType: string
}

export const layoutReferenceData: LayoutReferenceItem[] = [...]
```

**任务 1.3**: 创建 channel-studio-map.ts
**文件**: `src/data/channel-studio-map.ts`
```typescript
// 频道-演播室映射
export function getStudiosByChannelId(channelId: string) {
  return [...]
}
```

**任务 1.4**: 创建 permissions.ts
**文件**: `src/views/broadcast-plan/permissions.ts`
```typescript
// 权限相关
export interface BroadcastSection {
  id: string
  name: string
  canEdit: boolean
}

export function getBroadcastPlanPermission() {
  return { canEdit: true, sections: [] }
}
```

---

### 步骤 2：修改 create.vue

**任务 2.1**: 添加导入语句
```typescript
// 导入 LLM 相关组件和类型
import { useOrchestrator } from '@/composables/useOrchestrator'
import LLMConfigPanel from '@/components/llm/LLMConfigPanel.vue'
import OrchestrationProgress from '@/components/orchestration/OrchestrationProgress.vue'
import ChatPanel from '@/components/dialogue/ChatPanel.vue'
import type { ScheduleItem } from '@/types/llm'

// 导入数据
import { scheduleData } from './scheduleData'
import { layoutReferenceData } from './layoutReferenceData'
```

**任务 2.2**: 添加 AI 编排相关状态
```typescript
// AI 编排状态
const aiOrchestrationVisible = ref(false)
const aiConfigVisible = ref(false)
const aiChatVisible = ref(false)

// 使用编排组合式函数
const orchestrator = useOrchestrator({
  channelId: scheduleForm.channelId,
  channelName: '当前频道',
  date: scheduleForm.date,
  startTime: '06:00:00',
  endTime: '23:59:59',
  onComplete: (items) => {
    ElMessage.success('编排完成')
    // 更新 scheduleItems
  },
  onError: (error) => {
    ElMessage.error(error)
  }
})
```

**任务 2.3**: 添加 AI 编排按钮到工具栏
```vue
<template>
  <div class="timeline-header-left">
    <!-- 现有按钮 -->
    <el-button type="primary" :icon="Plus">添加节目</el-button>
    
    <!-- 新增：AI 智能编排按钮 -->
    <el-button
      type="success"
      :icon="MagicStick"
      @click="showAIOrchestration"
    >
      AI 智能编排
    </el-button>
  </div>
</template>
```

**任务 2.4**: 添加编排抽屉
```vue
<template>
  <el-drawer
    v-model="aiOrchestrationVisible"
    title="AI 智能编排"
    size="600px"
    direction="rtl"
  >
    <el-tabs>
      <el-tab-pane label="编排进度">
        <OrchestrationProgress
          :progress="orchestrator.progress.value"
          :can-cancel="orchestrator.canCancel.value"
          @cancel="orchestrator.cancel"
          @reset="orchestrator.reset"
        />
      </el-tab-pane>
      <el-tab-pane label="AI 配置">
        <LLMConfigPanel />
      </el-tab-pane>
    </el-tabs>
    
    <template #footer>
      <el-button @click="aiOrchestrationVisible = false">关闭</el-button>
      <el-button type="primary" @click="startOrchestration">
        开始编排
      </el-button>
    </template>
  </el-drawer>
</template>
```

**任务 2.5**: 添加对话面板
```vue
<template>
  <el-drawer
    v-model="aiChatVisible"
    title="AI 助手"
    size="400px"
    direction="rtl"
  >
    <ChatPanel
      :current-schedule="scheduleItems"
      @command-executed="handleCommandExecuted"
      @schedule-updated="handleScheduleUpdated"
    />
  </el-drawer>
</template>
```

**任务 2.6**: 添加方法
```typescript
const showAIOrchestration = () => {
  aiOrchestrationVisible.value = true
}

const startOrchestration = async () => {
  try {
    await orchestrator.start()
  } catch (error) {
    ElMessage.error(error.message)
  }
}

const handleCommandExecuted = (result) => {
  if (result.success) {
    ElMessage.success(result.message)
  } else {
    ElMessage.error(result.error || '执行失败')
  }
}

const handleScheduleUpdated = (items: ScheduleItem[]) => {
  // 更新本地的 scheduleItems
  scheduleItems.value = items
}
```

---

### 步骤 3：添加样式

**任务 3.1**: 添加 AI 相关样式
```scss
.ai-orchestration-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  
  &:hover {
    opacity: 0.9;
  }
}
```

---

### 步骤 4：测试验证

**任务 4.1**: 运行项目检查
```bash
npm run dev
```

**任务 4.2**: 验证功能
- [ ] AI 智能编排按钮显示正常
- [ ] 点击按钮打开编排抽屉
- [ ] 编排进度面板正常显示
- [ ] LLM 配置面板正常显示
- [ ] AI 对话面板正常显示
- [ ] 类型检查通过

---

## 三、实现顺序

### 第一天：基础工作（1-2小时）
1. 创建必要的类型定义文件
2. 添加导入语句到 create.vue
3. 添加 AI 编排状态

### 第二天：UI 集成（2-3小时）
1. 添加 AI 编排按钮
2. 添加编排抽屉
3. 添加对话面板
4. 添加相关方法

### 第三天：测试优化（1-2小时）
1. 运行项目测试
2. 修复问题
3. 优化交互

---

## 四、注意事项

1. **兼容性**: 确保新增代码与现有代码兼容
2. **错误处理**: 添加适当的错误处理和用户提示
3. **用户体验**: 确保加载状态和反馈清晰
4. **性能**: 注意大量数据渲染时的性能问题

---

*计划版本: v1.0*  
*最后更新: 2026-03-24*
