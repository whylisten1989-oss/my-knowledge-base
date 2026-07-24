(function exposeCustomerBIMatrix(global) {
    'use strict';

    const { ref, computed, watch } = Vue;
    const core = global.CustomerBICore;

    if (!core) {
        console.error('[Customer BI Matrix] CustomerBICore 未加载');
        return;
    }

    const METRIC_COLUMNS = Object.freeze([
        { key: 'totalScore', label: '综合得分', sortable: true, direction: 'desc', kind: 'score' },
        { key: 'satisfactionRate', label: '满意率', sortable: true, direction: 'desc', kind: 'satisfaction' },
        { key: 'avgResponseSeconds', label: '工作时间均响', sortable: true, direction: 'asc', kind: 'response' },
        { key: 'conversionRate', label: '转化率', sortable: true, direction: 'desc', kind: 'conversion' },
        { key: 'refundedSalesTotal', label: '退款后销售额', sortable: true, direction: 'desc', kind: 'sales' }
    ]);

    const DETAIL_COLUMNS = Object.freeze([
        { key: 'goodCount', label: '好评数', sortable: true, direction: 'desc' },
        { key: 'badCount', label: '差评数', sortable: true, direction: 'asc' },
        { key: 'inquiryCount', label: '询单人数', sortable: true, direction: 'desc' },
        { key: 'orderCount', label: '下单人数', sortable: true, direction: 'desc' },
        { key: 'participationDays', label: '参与日数', sortable: true, direction: 'desc' }
    ]);

    const isFiniteNumber = (value) => value !== null
        && value !== undefined
        && value !== ''
        && Number.isFinite(Number(value));

    const formatPercent = (value) => isFiniteNumber(value)
        ? `${(Number(value) * 100).toFixed(1)}%`
        : '—';

    const formatAttainment = (value) => isFiniteNumber(value)
        ? `${(Number(value) * 100).toFixed(1)}%`
        : '—';

    const formatSeconds = (value) => isFiniteNumber(value)
        ? `${Number(value).toFixed(1)} 秒`
        : '—';

    const formatScore = (value) => isFiniteNumber(value)
        ? Number(value).toFixed(1)
        : '—';

    const formatCurrency = (value) => isFiniteNumber(value)
        ? `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
        : '—';

    const formatInteger = (value) => isFiniteNumber(value)
        ? Math.round(Number(value)).toLocaleString('zh-CN')
        : '—';

    const scoreState = (value) => {
        if (!isFiniteNumber(value)) return 'empty';
        const score = Number(value);
        if (score >= 100) return 'excellent';
        if (score >= 80) return 'steady';
        return 'attention';
    };

    const attainmentOf = (row, key, rules) => {
        const value = Number(row?.[key]);
        if (!Number.isFinite(value)) return null;

        let rate = null;

        if (key === 'satisfactionRate') {
            rate = value / rules.targets.satisfaction;
        } else if (key === 'conversionRate') {
            rate = value / rules.targets.conversion;
        } else if (key === 'avgResponseSeconds') {
            if (value <= 0) return null;
            rate = rules.targets.responseSeconds / value;
        }

        return Number.isFinite(rate)
            ? Math.min(1.1, Math.max(0, rate))
            : null;
    };

    const metricState = (row, key, rules) => {
        const value = row?.[key];
        if (!isFiniteNumber(value)) return 'empty';

        if (key === 'satisfactionRate' || key === 'avgResponseSeconds' || key === 'conversionRate') {
            const attainment = attainmentOf(row, key, rules);
            if (attainment >= 1) return 'pass';
            if (attainment >= 0.95) return 'near';
            return 'fail';
        }

        if (key === 'totalScore') return scoreState(value);
        return 'info';
    };

    const metricMeta = (row, key, rules) => {
        const value = row?.[key];
        const state = metricState(row, key, rules);
        const attainment = attainmentOf(row, key, rules);

        if (key === 'satisfactionRate') {
            const target = rules.targets.satisfaction;
            const gap = !isFiniteNumber(value)
                ? '无有效评价数据'
                : Number(value) >= target
                    ? `高出 ${((Number(value) - target) * 100).toFixed(1)} 个百分点`
                    : `还差 ${((target - Number(value)) * 100).toFixed(1)} 个百分点`;

            return {
                display: formatPercent(value),
                target: `目标 ≥ ${(target * 100).toFixed(0)}%`,
                gap: attainment == null ? gap : `达成 ${formatAttainment(attainment)} · ${gap}`,
                attainment,
                state
            };
        }

        if (key === 'avgResponseSeconds') {
            const target = rules.targets.responseSeconds;
            const gap = !isFiniteNumber(value)
                ? '无有效均响数据'
                : Number(value) <= target
                    ? `优于目标 ${(target - Number(value)).toFixed(1)} 秒`
                    : `超出目标 ${(Number(value) - target).toFixed(1)} 秒`;

            return {
                display: formatSeconds(value),
                target: `目标 ≤ ${target} 秒`,
                gap: attainment == null ? gap : `达成 ${formatAttainment(attainment)} · ${gap}`,
                attainment,
                state
            };
        }

        if (key === 'conversionRate') {
            const target = rules.targets.conversion;
            const gap = !isFiniteNumber(value)
                ? '无有效转化数据'
                : Number(value) >= target
                    ? `高出 ${((Number(value) - target) * 100).toFixed(1)} 个百分点`
                    : `还差 ${((target - Number(value)) * 100).toFixed(1)} 个百分点`;

            return {
                display: formatPercent(value),
                target: `目标 ≥ ${(target * 100).toFixed(0)}%`,
                gap: attainment == null ? gap : `达成 ${formatAttainment(attainment)} · ${gap}`,
                attainment,
                state
            };
        }

        if (key === 'totalScore') {
            return {
                display: formatScore(value),
                target: '三项 KPI 加权',
                gap: state === 'excellent'
                    ? '卓越表现'
                    : state === 'steady'
                        ? '表现稳定'
                        : state === 'attention'
                            ? '需要关注'
                            : '无有效综合得分',
                attainment: null,
                state
            };
        }

        if (key === 'refundedSalesTotal') {
            return {
                display: row?.refundedSalesDays > 0 ? formatCurrency(value) : '—',
                target: `${row?.refundedSalesDays || 0} 个业务日有记录`,
                gap: row?.refundedSalesDays > 0 ? '当前周期累计' : '历史快照未保存该字段',
                attainment: null,
                state: row?.refundedSalesDays > 0 ? 'info' : 'empty'
            };
        }

        return {
            display: '—',
            target: '',
            gap: '',
            attainment: null,
            state: 'empty'
        };
    };

    const kpiSummary = (row, rules) => {
        const definitions = [
            {
                key: 'satisfactionRate',
                name: '满意率',
                shortName: '满意',
                weight: rules.weights.satisfaction
            },
            {
                key: 'avgResponseSeconds',
                name: '工作时间均响',
                shortName: '均响',
                weight: rules.weights.response
            },
            {
                key: 'conversionRate',
                name: '转化率',
                shortName: '转化',
                weight: rules.weights.conversion
            }
        ];

        const components = definitions.map((definition) => ({
            ...definition,
            attainment: attainmentOf(row, definition.key, rules)
        }));

        const validComponents = components.filter((item) => item.attainment !== null);
        const validWeight = validComponents.reduce((sum, item) => sum + item.weight, 0);

        const weightedAttainment = validWeight
            ? validComponents.reduce(
                (sum, item) => sum + item.attainment * item.weight,
                0
            ) / validWeight
            : null;

        const passed = validComponents.filter((item) => item.attainment >= 1).length;
        const near = validComponents.filter(
            (item) => item.attainment >= 0.9 && item.attainment < 1
        ).length;
        const failed = validComponents.filter((item) => item.attainment < 0.9).length;
        const failedLabels = validComponents
            .filter((item) => item.attainment < 1)
            .map((item) => item.name);

        const lowestAttainment = validComponents.length
            ? Math.min(...validComponents.map((item) => item.attainment))
            : null;

        const componentRates = {
            satisfaction: components.find((item) => item.key === 'satisfactionRate')?.attainment ?? null,
            response: components.find((item) => item.key === 'avgResponseSeconds')?.attainment ?? null,
            conversion: components.find((item) => item.key === 'conversionRate')?.attainment ?? null
        };

        let status = 'normal';
        let statusLabel = '综合达成';

        if (!row?.isQualified || validComponents.length < 3) {
            status = 'insufficient';
            statusLabel = '样本不足';
        } else if (weightedAttainment < 0.9 || lowestAttainment < 0.7) {
            status = 'risk';
            statusLabel = '高风险';
        } else if (weightedAttainment < 1) {
            status = 'pending';
            statusLabel = '待提升';
        }

        return {
            valid: validComponents.length,
            passed,
            near,
            failed,
            rate: weightedAttainment,
            weightedAttainment,
            componentRates,
            failedLabels,
            status,
            statusLabel
        };
    };

    const resolveMatrixScope = (availableDates, period, customStart, customEnd) => {
        if (period !== 'custom') {
            return core.resolvePeriodScope(availableDates, period);
        }

        const dates = availableDates.filter((date) =>
            (!customStart || date >= customStart)
            && (!customEnd || date <= customEnd)
        );

        const previousDates = availableDates
            .filter((date) => dates.length && date < dates[0])
            .slice(-dates.length);

        return {
            period: 'custom',
            baseDate: dates.at(-1) || null,
            currentDates: dates,
            previousDates,
            minimumParticipationDays: dates.length > 1 ? 2 : 1,
            provisional: false,
            comparisonComplete: Boolean(dates.length && previousDates.length === dates.length)
        };
    };

    const PerformanceMatrix = {
        name: 'PerformanceMatrix',
        props: {
            metrics: { type: Array, default: () => [] },
            availableDates: { type: Array, default: () => [] },
            rules: { type: Object, required: true },
            initialPeriod: { type: String, default: 'yesterday' },
            initialStart: { type: String, default: '' },
            initialEnd: { type: String, default: '' },
            periodOptions: {
                type: Array,
                default: () => [
                    { label: '昨日', value: 'yesterday' },
                    { label: '近 7 日', value: 'last7' },
                    { label: '本月', value: 'month' }
                ]
            }
        },
        emits: ['back', 'open-agent'],
        setup(props, { emit }) {
            const period = ref(props.initialPeriod || 'yesterday');
            const customStart = ref(props.initialStart || '');
            const customEnd = ref(props.initialEnd || '');
            const keyword = ref('');
            const statusFilter = ref('all');
            const onlyUnmet = ref(false);
            const mode = ref('compact');
            const sortKey = ref('rankPosition');
            const sortDirection = ref('asc');

            const scope = computed(() => resolveMatrixScope(
                props.availableDates,
                period.value,
                customStart.value,
                customEnd.value
            ));

            const ranking = computed(() => core.buildPeriodRanking(
                props.metrics,
                scope.value.currentDates,
                scope.value.minimumParticipationDays,
                scope.value.provisional
            ));

            const baseRows = computed(() => ranking.value.allRows.map((row) => ({
                ...row,
                matrix: kpiSummary(row, props.rules)
            })));

            const filteredRows = computed(() => {
                const search = keyword.value.trim().toLocaleLowerCase('zh-CN');

                return baseRows.value.filter((row) => {
                    const searchable = `${row.displayName} ${row.sourceAccount || ''} ${row.team || ''}`
                        .toLocaleLowerCase('zh-CN');

                    if (search && !searchable.includes(search)) return false;
                    if (onlyUnmet.value && row.matrix.status === 'normal') return false;
                    if (statusFilter.value !== 'all' && row.matrix.status !== statusFilter.value) return false;
                    return true;
                });
            });

            const sortedRows = computed(() => {
                const rows = [...filteredRows.value];
                const direction = sortDirection.value === 'asc' ? 1 : -1;

                rows.sort((a, b) => {
                    const left = sortKey.value === 'status'
                        ? ({ risk: 4, pending: 3, insufficient: 2, normal: 1 }[a.matrix.status] || 0)
                        : a[sortKey.value];

                    const right = sortKey.value === 'status'
                        ? ({ risk: 4, pending: 3, insufficient: 2, normal: 1 }[b.matrix.status] || 0)
                        : b[sortKey.value];

                    const leftEmpty = left === null || left === undefined || Number.isNaN(left);
                    const rightEmpty = right === null || right === undefined || Number.isNaN(right);

                    if (leftEmpty && rightEmpty) {
                        return a.displayName.localeCompare(b.displayName, 'zh-CN');
                    }
                    if (leftEmpty) return 1;
                    if (rightEmpty) return -1;

                    if (typeof left === 'string' || typeof right === 'string') {
                        return String(left).localeCompare(String(right), 'zh-CN') * direction;
                    }

                    return (Number(left) - Number(right)) * direction;
                });

                return rows;
            });

            const summary = computed(() => {
                const total = baseRows.value.length;
                let full = 0;
                let pending = 0;
                let risk = 0;
                let insufficient = 0;
                const validRows = [];

                baseRows.value.forEach((row) => {
                    if (row.matrix.status === 'normal') full += 1;
                    if (row.matrix.status === 'pending') pending += 1;
                    if (row.matrix.status === 'risk') risk += 1;
                    if (row.matrix.status === 'insufficient') insufficient += 1;

                    if (
                        row.matrix.status !== 'insufficient'
                        && row.matrix.weightedAttainment !== null
                    ) {
                        validRows.push(row);
                    }
                });

                const average = (getter) => {
                    const values = validRows
                        .map(getter)
                        .filter((value) => value !== null && Number.isFinite(value));

                    return values.length
                        ? values.reduce((sum, value) => sum + value, 0) / values.length
                        : null;
                };

                return {
                    total,
                    full,
                    pending,
                    risk,
                    insufficient,
                    weightedAttainment: average((row) => row.matrix.weightedAttainment),
                    satisfactionAttainment: average(
                        (row) => row.matrix.componentRates.satisfaction
                    ),
                    responseAttainment: average(
                        (row) => row.matrix.componentRates.response
                    ),
                    conversionAttainment: average(
                        (row) => row.matrix.componentRates.conversion
                    )
                };
            });

            const periodLabel = computed(() => {
                const dates = scope.value.currentDates;
                if (!dates.length) return '暂无已确认数据';
                if (dates.length === 1) return dates[0];
                return `${dates[0]} 至 ${dates.at(-1)} · ${dates.length} 个有效业务日`;
            });

            const visibleColumns = computed(() => mode.value === 'compact'
                ? METRIC_COLUMNS
                : [...METRIC_COLUMNS, ...DETAIL_COLUMNS]
            );

            const setPeriod = (value) => {
                period.value = value;
            };

            const applyRange = ({ start, end }) => {
                customStart.value = start;
                customEnd.value = end;
                period.value = 'custom';
            };

            const clearRange = () => {
                customStart.value = '';
                customEnd.value = '';
                period.value = 'yesterday';
            };

            const toggleSort = (column) => {
                if (!column.sortable) return;

                if (sortKey.value === column.key) {
                    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
                    return;
                }

                sortKey.value = column.key;
                sortDirection.value = column.direction || 'desc';
            };

            const sortIndicator = (key) => {
                if (sortKey.value !== key) return '';
                return sortDirection.value === 'asc' ? '↑' : '↓';
            };

            const cellMeta = (row, key) => metricMeta(row, key, props.rules);

            const detailDisplay = (row, key) => {
                if (key === 'participationDays') return `${formatInteger(row[key])} 日`;
                return formatInteger(row[key]);
            };

            const openAgent = (row) => emit('open-agent', {
                person: row,
                start: scope.value.currentDates[0] || '',
                end: scope.value.currentDates.at(-1) || ''
            });

            watch(() => props.initialPeriod, (value) => {
                if (value) period.value = value;
            });

            return {
                period,
                customStart,
                customEnd,
                keyword,
                statusFilter,
                onlyUnmet,
                mode,
                sortKey,
                sortDirection,
                scope,
                sortedRows,
                summary,
                periodLabel,
                visibleColumns,
                setPeriod,
                applyRange,
                clearRange,
                toggleSort,
                sortIndicator,
                cellMeta,
                detailDisplay,
                openAgent,
                formatPercent,
                formatAttainment
            };
        },
        template: `
            <section class="performance-matrix-view page-enter">
                <div class="matrix-page-heading">
                    <div class="matrix-page-title">
                        <button
                            class="matrix-back-button"
                            type="button"
                            @click="$emit('back')"
                            aria-label="返回总览"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m15 18-6-6 6-6"></path>
                            </svg>
                        </button>

                        <div>
                            <div class="eyebrow">PERFORMANCE MATRIX</div>
                            <h1>人员绩效矩阵</h1>
                            <p>{{ periodLabel }} · 颜色仅用于快速识别状态，具体数值仍为判断依据</p>
                        </div>
                    </div>

                    <div class="matrix-page-orbit" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <i></i>
                    </div>
                </div>

                <div class="matrix-control-panel">
                    <div class="matrix-period-control">
                        <div class="dashboard-period-switch" aria-label="详细数据时间范围">
                            <button
                                v-for="item in periodOptions"
                                :key="item.value"
                                :class="{ active: period === item.value }"
                                @click="setPeriod(item.value)"
                            >
                                {{ item.label }}
                            </button>

                            <date-range-picker
                                :start="customStart"
                                :end="customEnd"
                                :available-dates="availableDates"
                                :active="period === 'custom'"
                                @apply="applyRange"
                                @clear="clearRange"
                            ></date-range-picker>
                        </div>
                    </div>

                    <label class="matrix-search">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="11" cy="11" r="7"></circle>
                            <path d="m20 20-4-4"></path>
                        </svg>
                        <input
                            v-model.trim="keyword"
                            type="search"
                            placeholder="搜索客服名称或账号"
                        >
                    </label>

                    <select
                        v-model="statusFilter"
                        class="matrix-select"
                        aria-label="人员状态筛选"
                    >
                        <option value="all">全部状态</option>
                        <option value="normal">综合达成</option>
                        <option value="pending">待提升</option>
                        <option value="risk">高风险</option>
                        <option value="insufficient">样本不足</option>
                    </select>

                    <label class="matrix-switch">
                        <input v-model="onlyUnmet" type="checkbox">
                        <span></span>
                        <b>只看未达标</b>
                    </label>

                    <div class="matrix-mode-switch">
                        <button
                            :class="{ active: mode === 'compact' }"
                            @click="mode = 'compact'"
                        >
                            简洁
                        </button>
                        <button
                            :class="{ active: mode === 'full' }"
                            @click="mode = 'full'"
                        >
                            完整
                        </button>
                    </div>
                </div>

                <article class="matrix-data-panel">
                    <div class="matrix-data-header">
                        <div class="matrix-data-title">
                            <h2>人员 × 指标数据</h2>
                            <p>点击表头排序 · 点击人员行进入现有人员详情</p>
                        </div>

                        <div class="matrix-header-side">
                            <div class="matrix-mini-stats" aria-label="矩阵汇总数据">
                                <article class="matrix-mini-stat stat-total">
                                    <span>参评人数</span>
                                    <b>{{ summary.total }}</b>
                                    <small>{{ scope.currentDates.length }} 个业务日</small>
                                </article>

                                <article class="matrix-mini-stat stat-pass">
                                    <span>综合达成</span>
                                    <b>{{ summary.full }}</b>
                                    <small>加权达成 ≥ 100%</small>
                                </article>

                                <article class="matrix-mini-stat stat-pending">
                                    <span>待提升</span>
                                    <b>{{ summary.pending }}</b>
                                    <small>加权达成 90%～99.9%</small>
                                </article>

                                <article class="matrix-mini-stat stat-risk">
                                    <span>高风险</span>
                                    <b>{{ summary.risk }}</b>
                                    <small>低于 90% 或单项过低</small>
                                </article>

                                <article class="matrix-mini-stat stat-rate">
                                    <span>团队加权达成率</span>
                                    <b>{{ formatAttainment(summary.weightedAttainment) }}</b>
                                    <small>
                                        满意 {{ formatAttainment(summary.satisfactionAttainment) }}
                                        · 均响 {{ formatAttainment(summary.responseAttainment) }}
                                        · 转化 {{ formatAttainment(summary.conversionAttainment) }}
                                    </small>
                                </article>
                            </div>

                            <div class="matrix-legend">
                                <span class="legend-pass"><i></i>达标</span>
                                <span class="legend-near"><i></i>接近目标</span>
                                <span class="legend-fail"><i></i>未达标</span>
                                <span class="legend-empty"><i></i>无数据</span>
                            </div>
                        </div>
                    </div>

                    <div v-if="sortedRows.length" class="matrix-table-scroll">
                        <table class="performance-table">
                            <thead>
                                <tr>
                                    <th class="sticky-rank">
                                        <button
                                            @click="toggleSort({
                                                key: 'rankPosition',
                                                sortable: true,
                                                direction: 'asc'
                                            })"
                                        >
                                            排名 {{ sortIndicator('rankPosition') }}
                                        </button>
                                    </th>

                                    <th class="sticky-agent">
                                        <button
                                            @click="toggleSort({
                                                key: 'displayName',
                                                sortable: true,
                                                direction: 'asc'
                                            })"
                                        >
                                            客服 {{ sortIndicator('displayName') }}
                                        </button>
                                    </th>

                                    <th
                                        v-for="column in visibleColumns"
                                        :key="column.key"
                                    >
                                        <button @click="toggleSort(column)">
                                            {{ column.label }} {{ sortIndicator(column.key) }}
                                        </button>
                                    </th>

                                    <th class="sticky-status">
                                        <button
                                            @click="toggleSort({
                                                key: 'status',
                                                sortable: true,
                                                direction: 'desc'
                                            })"
                                        >
                                            综合状态 {{ sortIndicator('status') }}
                                        </button>
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                <tr
                                    v-for="row in sortedRows"
                                    :key="row.agentId || row.sourceAccount"
                                    :class="[
                                        'matrix-person-row',
                                        'row-' + row.matrix.status
                                    ]"
                                    @click="openAgent(row)"
                                >
                                    <td class="sticky-rank">
                                        <span
                                            :class="[
                                                'matrix-rank-token',
                                                { podium: row.rankPosition <= 3 }
                                            ]"
                                        >
                                            {{ row.rankPosition || '—' }}
                                        </span>
                                    </td>

                                    <td class="sticky-agent">
                                        <div class="matrix-agent-cell">
                                            <span class="matrix-avatar">
                                                {{ row.displayName.slice(0, 1) }}
                                            </span>
                                            <div>
                                                <b>{{ row.displayName }}</b>
                                                <small>
                                                    {{ row.participationDays }} 日参与
                                                    · {{ row.sourceAccount || '无账号' }}
                                                </small>
                                            </div>
                                        </div>
                                    </td>

                                    <td
                                        v-for="column in visibleColumns"
                                        :key="column.key"
                                        :class="[
                                            'matrix-value-cell',
                                            column.kind
                                                ? 'state-' + cellMeta(row, column.key).state
                                                : 'state-info',
                                            { 'detail-number-cell': !column.kind }
                                        ]"
                                    >
                                        <template v-if="column.kind">
                                            <strong>{{ cellMeta(row, column.key).display }}</strong>
                                            <span>{{ cellMeta(row, column.key).target }}</span>
                                            <small>{{ cellMeta(row, column.key).gap }}</small>
                                        </template>

                                        <template v-else>
                                            <strong>{{ detailDisplay(row, column.key) }}</strong>
                                            <span>当前周期累计</span>
                                        </template>
                                    </td>

                                    <td class="sticky-status">
                                        <div
                                            :class="[
                                                'matrix-status-card',
                                                row.matrix.status
                                            ]"
                                        >
                                            <i></i>
                                            <div>
                                                <b>{{ row.matrix.statusLabel }}</b>
                                                <span>
                                                    综合达成
                                                    {{ formatAttainment(row.matrix.weightedAttainment) }}
                                                </span>
                                                <small>
                                                    满意
                                                    {{ formatAttainment(row.matrix.componentRates.satisfaction) }}
                                                    · 均响
                                                    {{ formatAttainment(row.matrix.componentRates.response) }}
                                                    · 转化
                                                    {{ formatAttainment(row.matrix.componentRates.conversion) }}
                                                </small>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div v-else class="matrix-empty-state">
                        <span>◇</span>
                        <h3>当前筛选条件下没有人员数据</h3>
                        <p>请调整日期范围、搜索词或状态筛选。</p>
                    </div>
                </article>
            </section>
        `
    };

    global.CustomerBIMatrix = Object.freeze({
        PerformanceMatrix,
        metricState,
        metricMeta,
        kpiSummary,
        resolveMatrixScope
    });
})(window);