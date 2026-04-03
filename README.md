# bigbiandan-ui

广电串联单 AI 自动编排前端原型。

当前仓库基于 Vue 3、Vite、TypeScript、Element Plus 构建，聚焦一条完整演示链路：

- 串联单编辑
- AI 对话式微调
- AI 全量/局部编排
- 版面 Excel 导入
- 编排日志与校验反馈

## 当前状态

- `vue-tsc --build` 已通过
- `eslint . --cache` 已通过
- `npm run test` 已通过
- `vite build` 已通过
- 已建立 `Vitest` 测试基线
- 当前已有 13 个测试文件、57 个用例

说明：
- 项目现在已经不是“没有护栏的原型”
- 但业务数据仍主要来自 `src/mock/`，浏览器端仍直接持有 LLM 配置
- 这仍是演示型前端工程，不是生产化交付版本

## 目录说明

```text
src/
  components/
    dialogue/                   对话面板及其拆分 helper
  composables/                  通用组合式逻辑
  mock/                         演示数据
  services/                     编排、命令、校验、导入、LLM 等核心服务
  types/                        领域类型
  views/broadcast-plan/         串联单主页面与页面级 helper/composable
docs/
  current-status.md             当前真实状态
  architecture.md               当前架构说明
  module-map.md                 拆分后模块地图
  tech-debt.md                  当前技术债台账
  testing-baseline.md           测试基线说明
```

## 关键入口

- 页面入口：[create.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/views/broadcast-plan/create.vue)
- 对话面板：[ChatPanel.vue](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/components/dialogue/ChatPanel.vue)
- 编排组合逻辑：[useOrchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/composables/useOrchestrator.ts)
- 编排引擎：[orchestrator.ts](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/src/services/orchestrator.ts)

## 本地运行

建议使用 Node.js `20.19+` 或 `22.12+`。

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

构建：

```bash
npm run build
```

测试：

```bash
npm run test
```

类型检查：

```bash
cmd /c node_modules\.bin\vue-tsc.cmd --build
```

Lint：

```bash
cmd /c node_modules\.bin\eslint.cmd . --cache
```

## LLM 配置

当前支持两类来源：

- 环境变量：`VITE_CODE_PLAN_LLM_BASE_URL`、`VITE_CODE_PLAN_LLM_API_KEY`、`VITE_CODE_PLAN_LLM_MODEL`
- 浏览器本地存储：由界面中的配置面板写入 `localStorage`

注意：
- 当前实现仍是浏览器端直连模型
- 适合原型演示，不适合生产环境直接使用

## 推荐阅读顺序

1. [docs/current-status.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/current-status.md)
2. [docs/architecture.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/architecture.md)
3. [docs/module-map.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/module-map.md)
4. [docs/tech-debt.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/tech-debt.md)
5. [docs/testing-baseline.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/testing-baseline.md)
