# Kimi 2.5 编排LLM接入开发计划（修正版）

> **版本**: v1.1  
> **日期**: 2026-03-24  
> **工作目录**: `C:\Users\sucongfei\Documents\trae_projects\bigbiandan2`  
> **目标**: 在当前目录下接入字节Code Plan中的Kimi 2.5，实现LLM自动编排功能

---

## 一、当前目录结构分析

```
bigbiandan2/
├── create.vue                    # 现有的串联单编辑页面（需要集成AI编排）
├── LLM自动编排串联单-需求文档.md   # 需求文档
├── LLM自动编排串联单-需求文档-附录.md
├── .trae/documents/              # 开发计划文档
└── ...
```

**开发策略**: 直接在 `bigbiandan2` 目录下创建 `src/` 文件夹和相关文件，与 `create.vue` 集成。

---

## 二、接入方案概述

### 2.1 Kimi 2.5 API 配置（字节Code Plan环境）

```typescript
// 配置来源优先级：
// 1. 字节Code Plan环境变量
// 2. 用户本地配置（localStorage）
// 3. 默认值

const LLM_CONFIG = {
  baseURL: import.meta.env.VITE_CODE_PLAN_LLM_BASE_URL || 'https://api.moonshot.cn/v1',
  apiKey: import.meta.env.VITE_CODE_PLAN_LLM_API_KEY || '',
  model: 'kimi-k2.5',           // 或 Code Plan 提供的模型ID
  temperature: 0.3,
  maxTokens: 8192,
  timeout: 60000
}
```

### 2.2 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    字节Code Plan环境                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Kimi 2.5 LLM Service                       │   │
│  │  · 模型: kimi-k2.5 (32K上下文)                           │   │
│  │  · 输出: JSON结构化命令                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              bigbiandan2/ 项目目录                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  src/services/llm/                                      │   │
│  │  ├── llmClient.ts      - OpenAI SDK封装                 │   │
│  │  ├── llmConfig.ts      - 配置管理                        │   │
│  │  ├── promptBuilder.ts  - Prompt构建器                    │   │
│  │  ├── contextBuilder.ts - 上下文构建                      │   │
│  │  └── responseParser.ts - 响应解析                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  src/services/orchestrator.ts - 编排调度器               │   │
│  │  ├── Phase 0: 初始化                                     │   │
│  │  ├── Phase 1: 规划 (1次LLM调用)                          │   │
│  │  ├── Phase 2: 渐进式填充 (N×2次LLM调用)                   │   │
│  │  └── Phase 3: 修补 (0~M次LLM调用)                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  create.vue (现有文件，需要修改)                         │   │
│  │  ├── 添加"AI智能编排"按钮                                │   │
│  │  ├── 集成编排进度抽屉                                    │   │
│  │  ├── 集成对话面板Tab                                     │   │
│  │  └── 集成校验报告Tab                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、开发阶段规划（在当前目录执行）

### 阶段一：创建项目结构（第1天）

**工作目录**: `C:\Users\sucongfei\Documents\trae_projects\bigbiandan2`

#### 任务 1.1: 创建目录结构
**优先级**: P0  
**预计耗时**: 1小时

**创建的目录**:
```
bigbiandan2/
├── src/
│   ├── types/                    # TypeScript类型定义
│   ├── services/
│   │   ├── llm/                  # LLM相关服务
│   │   ├── dialogue/             # 对话系统
│   │   └── atomic/               # 原子能力层
│   ├── stores/                   # Pinia状态管理
│   ├── components/
│   │   ├── llm/                  # LLM配置组件
│   │   ├── orchestration/        # 编排进度组件
│   │   ├── dialogue/             # 对话面板组件
│   │   └── validation/           # 校验报告组件
│   ├── composables/              # Vue组合式函数
│   └── utils/                    # 工具函数
├── mock/                         # Mock数据
└── ...
```

**命令**:
```powershell
mkdir -p src/types src/services/llm src/services/dialogue src/services/atomic src/stores src/components/llm src/components/orchestration src/components/dialogue src/components/validation src/composables src/utils mock
```

---

#### 任务 1.2: 初始化package.json和依赖
**优先级**: P0  
**预计耗时**: 2小时

**文件**: `bigbiandan2/package.json`

**依赖安装**:
```bash
npm init -y
npm install vue@3 pinia openai element-plus @element-plus/icons-vue lodash-es dayjs uuid
npm install -D typescript vite @vitejs/plugin-vue @types/lodash-es @types/uuid
```

---

### 阶段二：类型定义（第1天）

#### 任务 2.1: 创建类型定义文件
**优先级**: P0  
**预计耗时**: 4小时

**文件列表**:
- `src/types/channel.ts` - 频道类型
- `src/types/program.ts` - 节目库类型
- `src/types/schedule.ts` - 串联单类型
- `src/types/command.ts` - LLM命令协议
- `src/types/validation.ts` - 校验规则类型
- `src/types/intent.ts` - 意图识别类型
- `src/types/index.ts` - 类型导出

**关键类型**:
```typescript
// src/types/schedule.ts
export interface ScheduleItem {
  id: string
  startTime: string      // HH:mm:ss
  endTime: string        // HH:mm:ss
  duration: number       // 秒
  programName: string
  businessType: 'program' | 'ad' | 'promo'
  sourceType: 'record' | 'live'
  code18?: string        // 18位成品编码
  // ... 其他字段
}

// src/types/command.ts
export type ScheduleCommand =
  | { action: 'plan'; blocks: TimeBlock[]; explanation: string }
  | { action: 'fill_item'; blockId: string; selectedProgram: {...}; reasoning: string }
  | { action: 'insert'; afterItemId: string | null; items: RundownItem[]; explanation: string }
  | { action: 'delete'; targetIds: string[]; explanation: string }
  | { action: 'replace'; replacements: {...}[]; explanation: string }
  // ... 其他命令
```

---

### 阶段三：LLM基础设施（第2天）

#### 任务 3.1: LLM客户端封装
**优先级**: P0  
**预计耗时**: 4小时

**文件**: `src/services/llm/llmClient.ts`

**功能**:
- OpenAI SDK初始化（兼容Moonshot API）
- 字节Code Plan环境配置读取
- 请求/响应拦截
- 重试机制（指数退避，最多3次）
- Token使用量统计

**代码结构**:
```typescript
import OpenAI