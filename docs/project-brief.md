# 项目总览（汇报版）

更新时间：2026-04-02

## 一、项目一句话

这是一个“广电节目串联单 AI 自动编排”的前端演示原型，目标是让编单员围绕频道、日期、版面参考和节目候选，通过 AI 辅助完成串联单生成、调整和校验。

## 二、当前阶段判断

当前项目处于：

“核心演示链路已打通，但仍属于原型阶段”

更具体地说：

- 前端页面已经可运行、可构建、可演示
- 主流程已经覆盖“编辑 + 对话 + 编排 + 校验 + 版面导入”
- 数据层仍以 mock 为主，尚未进入真实业务接入阶段
- 工程质量和可维护性还没有收口，继续堆功能的成本会越来越高

## 三、当前已经具备的能力

### 1. 页面主流程

- 已有串联单编辑主页面
- 支持频道、日期切换
- 支持节目单表格展示与编辑
- 支持 AI 侧边栏联动

### 2. AI 能力

- 支持对话式微调
- 支持自然语言触发命令识别、确认和执行
- 支持空窗编排主流程
- 支持编排过程日志和状态反馈

### 3. 业务辅助能力

- 支持版面 Excel 文件导入
- 支持基础校验规则
- 支持风险高亮和问题提示
- 支持本地 LLM 参数配置与连接测试

## 四、当前最重要的现状结论

### 结论 1

项目不是空壳，已经具备可展示的核心原型。

### 结论 2

项目还没有进入“稳定交付”状态，主要原因不是功能完全没做，而是：

- 代码集中度太高
- lint 和类型负债较多
- 自动化测试缺失
- 文档与实现之前存在偏差

### 结论 3

当前最值得做的事不是继续横向堆功能，而是先把工程地基补平。

## 五、和需求目标相比，当前做到哪里了

### 已实现或接近实现

- F01 频道与日期选择
- F04 串联单编辑表格
- F07 对话式微调
- 校验规则基础能力
- 版面导入能力

### 部分实现

- F02 LLM 分步编排
- F03 编排进度面板
- F05 校验报告面板
- F06 版面参考对比能力

### 尚未形成闭环

- F08 编排结果导出
- F09 编排历史记录
- 节目库生成脚本和数据闭环

## 六、当前主要风险

### 1. 可维护性风险

- `create.vue`、`ChatPanel.vue`、`orchestrator.ts` 文件过大
- 后续修改容易相互牵连

### 2. 质量风险

- 当前 `eslint` 仍有较多问题未收敛
- 存在 `@ts-nocheck`
- 暂无测试基线

### 3. 架构风险

- 页面层和业务流程层耦合偏高
- 数据访问层仍高度依赖 mock

### 4. 安全边界风险

- 当前 LLM 调用发生在浏览器端
- 配置会写入 `localStorage`
- 适合原型演示，不适合直接进入生产方案

## 七、建议的下一步

### 第一优先级

- 降 lint 负债
- 建最小测试基线
- 拆分 `create.vue`
- 拆分 `ChatPanel.vue`

### 第二优先级

- 收口 `orchestrator.ts`
- 补校验报告面板
- 补编排进度面板
- 补版面参考展示

### 第三优先级

- 决定是否做导出与历史
- 决定是否引入真实数据接口
- 决定是否把 LLM 调用迁出浏览器端

## 八、建议的汇报口径

如果需要对外同步，建议用这段话：

“项目当前已经完成 AI 串联单编排原型的核心链路，前端主页面、对话微调、基础编排、校验反馈和版面导入能力都已经具备演示基础。下一阶段的重点不是继续堆功能，而是先完成主流程减重、质量基线建立和关键面板补齐，再决定是否进入真实数据和产品化阶段。”

## 九、相关文档

- 项目入口说明：[README.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/README.md)
- 当前状态：[docs/current-status.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/current-status.md)
- 架构说明：[docs/architecture.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/architecture.md)
- 技术债台账：[docs/tech-debt.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/tech-debt.md)
- 功能对齐清单：[docs/feature-alignment.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/feature-alignment.md)
- 迭代路线图：[docs/roadmap.md](/C:/Users/sucongfei/Documents/trae_projects/bigbiandan2/docs/roadmap.md)
