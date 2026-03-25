# 修复 create.vue 页面计划

## 问题诊断

1. **路由错误**: router/index.ts 引用了 `../views/demo/OrchestrationDemo.vue`，但 demo 目录可能不存在或文件不完整
2. **create.vue 需要更新**: 需要将新开发的编排功能完整集成到 create.vue 页面

## 修复步骤

### 步骤 1: 修复路由配置
**文件**: `src/router/index.ts`
- 移除对 demo/OrchestrationDemo.vue 的引用
- 保持首页指向 create.vue

### 步骤 2: 检查并修复 create.vue 的编排集成
**文件**: `src/views/broadcast-plan/create.vue`

需要确保以下组件正确导入和使用：
1. TaskModeSelector - 任务模式选择器
2. GapVisualizer - 空窗可视化
3. OrchestrationProgress - 编排进度（已存在，需检查）
4. ChatPanel - 对话面板（已存在，需检查）

### 步骤 3: 验证类型导入
确保所有类型正确导入：
- TaskMode
- GapInfo
- OrchestrationProgress

### 步骤 4: 检查编排抽屉的 Tab 配置
确保 el-tabs 的 v-model 和各个 el-tab-pane 的 name 属性正确匹配

### 步骤 5: 运行测试
- 运行 TypeScript 类型检查
- 启动开发服务器验证页面正常打开

## 预期结果
- 页面能正常打开不报错
- "AI 智能编排"按钮能正常点击
- 编排抽屉能正常显示四个标签页：
  1. 任务选择 - 显示6种任务模式
  2. 空窗可视化 - 显示时间轴
  3. 编排进度 - 显示进度面板
  4. AI 配置 - 显示配置面板
