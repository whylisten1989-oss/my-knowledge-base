# 客服绩效 BI：阶段一设计包

> 状态：阶段一已通过；V1 采用 Dashboard 方案 A，并在独立 feature 分支开发。
>
> Git 分支：`feature/customer-service-bi`
>
> 参考数据：`数据参考722.xlsx`（Sheet1，A1:AI57）

## 业务边界

本模块中的 Customer BI 指“客服团队 KPI 绩效分析系统”。核心对象是每日参与统计的客服人员及其满意率、平均响应时长、转化率、综合得分、排名和荣誉。

明确排除：

- 微信小店均响及所有微信小店衍生 KPI；
- 客户订单系统、客户画像、LTV、客户分群和客户收入分析；
- 未被用户纳入本次统计范围的 Excel 人员。

## 文件索引

| 文件 | 用途 |
|---|---|
| [phase-1-design.md](phase-1-design.md) | 阶段一完整业务与技术设计、KPI、聚合、快照、任务拆分和待确认问题 |
| [excel-field-mapping.md](excel-field-mapping.md) | 真实 Excel 字段识别、映射与忽略规则 |
| [migration-draft.sql](migration-draft.sql) | 单文件 SQL migration 草案，仅供评审，不应在本阶段执行 |
| [V1-README.md](V1-README.md) | V1 运行入口与最简 Supabase 初始化说明 |
| [system-architecture.svg](system-architecture.svg) | 系统底层架构与独立 Supabase 边界 |
| [data-flow.svg](data-flow.svg) | Excel 导入、人员选择、校验、快照、排名和 Dashboard 数据流 |
| [database-erd.svg](database-erd.svg) | 数据库实体关系图 |
| [dashboard-wireframe.svg](dashboard-wireframe.svg) | Dashboard 方案 A/B 对比图 |
| [dashboard-wireframe-a.svg](dashboard-wireframe-a.svg) | 方案 A：高密度管理驾驶舱 |
| [dashboard-wireframe-b.svg](dashboard-wireframe-b.svg) | 方案 B：现代产品化卡片布局 |
| [import-wizard-wireframe.svg](import-wizard-wireframe.svg) | 五步 Excel 导入向导 |
| [agent-detail-wireframe.svg](agent-detail-wireframe.svg) | 客服个人详情页 |
| [mobile-wireframe.svg](mobile-wireframe.svg) | 手机端核心页面布局 |

`previews/` 目录包含上述 9 张 SVG 的 PNG 预览，便于不支持直接显示 SVG 的场景查看；SVG 仍是后续修改的主文件。

## Dashboard 两套方案

### 方案 A：管理驾驶舱

优点：同屏信息多、趋势与榜单对照快、适合主管每日复盘和大屏使用。

缺点：首次使用的学习成本更高；小屏需要更明显的分区折叠。

### 方案 B：现代产品化

优点：卡片层级清晰、重点更突出、留白更多，适合日常桌面和移动端延展。

缺点：同屏可见信息较少，主管进行横向对比时需要更多滚动或点击。

已确认采用方案 A 作为 V1 桌面 Dashboard；方案 B 仅作为历史备选设计保留。

## 关键设计结论

1. 每次导入必须保存“原始文件人员、纳入人员、排除人员、规则版本和正式计算结果”。
2. 默认名单只负责预选，不能回写或改变历史批次的人员范围。
3. 已确认批次不可覆盖；修正通过新 revision 追加并关联被替代批次。
4. 未选择人员不写入正式 KPI、排名或荣誉表，只保留在导入审计记录中。
5. 历史页面默认展示官方快照；切换人员范围后进入“动态分析模式”，临时重算但不覆盖官方排名和荣誉。
6. 平均响应时长当前采用有效参与人员的简单平均，界面必须展示未按会话量加权的提示。
7. 微信小店相关列采用“识别并忽略”策略，不影响其他字段解析。
