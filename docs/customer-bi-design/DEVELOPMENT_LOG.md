# 客服绩效 BI 中文开发日志

> 本文件只追加、不覆盖旧记录。测试状态按实际执行结果填写；没有执行或没有验证的事项会明确注明。

## 2026-07-22 03:06（阶段基线）

### 当前分支

`feature/customer-service-bi`。本次开发继续在独立功能分支上进行，不合并到 `main`。

### 当前提交

`bc47c2a feat: add customer service BI v1`

### 本阶段完成内容

- 已建立可打开的 Customer BI V1 页面和五步 Excel 导入向导。
- 已实现 Excel 浏览器端真实解析、业务日期选择、人员勾选、KPI 校验预览和确认保存流程。
- 已实现满意率、工作时间平均响应时长、转化率、综合得分和日排名计算。
- 已生成独立 Supabase 数据库 SQL，页面只配置 Project URL 和 publishable key（公开前端密钥）。
- 已实现第一版驾驶舱、人员详情抽屉、Skeleton 骨架屏、Toast 提示、卡片抬升和分步过渡动画。
- 微信小店相关字段在解析阶段主动忽略，不参与任何 KPI、排名和展示。
- 本轮新增要求中的“昨日、近 7 个有效业务日、本月”统一时间维度尚未开始改造。
- 按用户最新要求，手机端适配暂停；不会在本轮继续扩大手机端开发范围。

### 为什么这样实现

当前网站是 Vue 3 CDN 静态多页面架构，没有 npm 构建流程。Customer BI 因此继续采用独立 HTML、CSS 和 JavaScript 文件，避免影响现有 Finance、Habits、Wiki、Profile 页面，也避免把项目改造成 Vite、Next.js 等全新工程。

Excel 先在浏览器本地解析，用户确认人员和结果后才写入数据库。这样可以防止文件里的无关人员被自动计入团队指标和排名，也可以在正式保存前发现字段问题。

### 新增文件

- `customer-bi.html`：客服绩效 BI 主页面。
- `css/customer-bi.css`：驾驶舱、导入向导、人员详情和动效样式。
- `js/customer-bi-config.js`：独立 Supabase Project URL 与 publishable key 配置。
- `js/customer-bi-core.js`：Excel 解析、KPI 评分、团队汇总和排名的纯计算逻辑。
- `js/customer-bi.js`：Vue 页面状态、导入流程、Supabase 读写和 ECharts 图表逻辑。
- `supabase/customer-bi-v1.sql`：最小 V1 数据表、约束、索引和 RLS（行级安全策略）完整 SQL。
- `docs/customer-bi-design/`：阶段一设计图、说明和 V1 使用说明。

### 修改文件

未修改现有生产业务页面和 `js/config.js`。

### 数据库变更

SQL 已包含 `bi_agents`、`bi_import_batches`、`bi_import_batch_agents`、`bi_daily_metrics`、`bi_daily_rankings`，以及基础的 `bi_achievements`、`bi_kpi_rules`、`bi_team_daily_summary`。

- 已设计唯一约束，防止同一用户同一业务日期保留多个当前批次。
- 已设计常用查询索引。
- 已启用 RLS，并限制登录用户读取和写入自己的数据。
- SQL 状态：**已生成，尚未执行**。
- Supabase 状态：**尚未验证连接**。
- 正式数据写入：**尚未验证**。

### 功能实现状态

- Excel 真实解析：已完成。
- 人员全选、取消全选、反选和搜索：已完成。
- KPI 计算与日排名：已完成。
- Supabase 保存代码：已完成；数据库尚未初始化，因此真实保存尚未验证。
- 昨日看板：部分完成；已有单日快照展示，但尚未改成“最近 confirmed 有效业务日”的正式定义。
- 近 7 个有效业务日：尚未开始。
- 本月自然月聚合：尚未开始。
- 人员详情三时间维度：尚未开始。
- 手机端追加适配：按用户要求暂停。
- Vercel Preview：**尚未生成**。

### 测试结果

- 测试输入：用户提供的 `数据参考722.xlsx`。
- 测试内容：读取第一个工作表、识别人员、识别工作时间平均响应时长、计算满意率和转化率、忽略微信小店字段。
- 预期结果：文件能够真实解析；无关字段不阻塞其他数据；只对有效且选中的人员计算。
- 实际结果：识别到 54 行人员记录，其中 9 行具备完整核心 KPI；9 人团队满意率约 81.11%，转化率约 43.31%，简单平均响应时长约 17.56 秒。
- 测试结论：Excel 解析与已确认评分阈值通过本地计算测试。
- 浏览器测试：页面、导入向导、真实 Excel 选择与 KPI 预览已经运行；控制台仅观察到 Tailwind CDN 的生产环境提示，不影响本地 V1 功能。
- Supabase 保存测试：未执行，因为 SQL 尚未在目标项目中运行。

### 已知问题

- 当前 Dashboard 的日、周、月趋势切换不符合最新业务定义，需要统一改为昨日、近 7 个有效业务日、本月。
- 当前人员详情只展示单日值和已有历史趋势，需要增加相同的三个时间维度。
- 页面依赖 CDN；离线环境下 Vue、ECharts、SheetJS、Supabase SDK 和 Tailwind 可能无法加载。
- SQL 未执行前，页面可以解析和预览 Excel，但不能保存或读取正式历史快照。

### 需要用户操作

当前阶段不要求立即操作。需要启用正式保存时，只需：

1. 打开 Supabase。
2. 点击左侧 SQL Editor。
3. 点击 New query。
4. 粘贴 `supabase/customer-bi-v1.sql` 的完整内容。
5. 点击 Run。

### 下一步计划

先实现可独立测试的有效业务日范围、近 7 日和本月聚合规则，再改造 Dashboard 和人员详情。这样可以先保证统计口径正确，再处理页面动效和展示，避免图表看起来正常但底层数据口径错误。
