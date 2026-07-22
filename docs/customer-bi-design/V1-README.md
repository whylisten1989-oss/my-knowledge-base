# 客服绩效 BI V1

入口页面：`customer-bi.html`

V1 已实现：Excel 解析、业务日期、人员勾选、KPI 校验与预览、Supabase 保存代码、Dashboard 昨日/近 7 个有效业务日/本月视图、综合排名和人员详情。

当前 Supabase SQL 已生成但尚未执行，因此本地解析和预览可用，正式历史保存仍需先完成下方初始化。

## 首次初始化 Supabase

操作 1：
打开 Supabase → 点击 SQL Editor → 点击 New query。

操作 2：
粘贴仓库中 `supabase/customer-bi-v1.sql` 的完整 SQL。

操作 3：
点击 Run。

## 使用

1. 打开 `customer-bi.html`。
2. 点击右上角“登录后保存”，注册或登录 Customer BI 账号。
3. 点击“导入数据”，上传 Excel 并完成五步向导。

未运行 SQL 时仍可解析 Excel 和查看 KPI 预览，但不能保存正式快照。
