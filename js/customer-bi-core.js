(function exposeCustomerBICore(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.CustomerBICore = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function createCustomerBICore() {
    const RULES = Object.freeze({
        version: 'v1-2026-07-22',
        responseSource: '工作时间平响时长',
        weights: Object.freeze({ satisfaction: 0.50, conversion: 0.25, response: 0.25 }),
        targets: Object.freeze({ satisfaction: 0.90, conversion: 0.30, responseSeconds: 15 })
    });

    const CORE_HEADERS = Object.freeze({
        account: '客服账号',
        nickname: '客服昵称',
        good: '有效好评数',
        bad: '有效差评数',
        response: '工作时间平响时长',
        inquiries: '询单人数',
        orders: '下单人数',
        refundedSales: '退款后销售额'
    });

    const cleanText = (value) => value == null ? '' : String(value).trim();

    const toNumber = (value) => {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const normalized = String(value).replace(/,/g, '').replace(/%/g, '').trim();
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const toCount = (value) => {
        const parsed = toNumber(value);
        if (parsed == null || parsed < 0) return null;
        return Math.round(parsed);
    };

    const parseDurationSeconds = (value) => {
        if (value == null || value === '') return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.getUTCHours() * 3600 + value.getUTCMinutes() * 60 + value.getUTCSeconds();
        }
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value < 0) return null;
            return value > 0 && value < 1 ? Math.round(value * 86400 * 100) / 100 : Math.round(value * 100) / 100;
        }
        const text = cleanText(value).toLowerCase();
        if (!text) return null;
        const colon = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/);
        if (colon) {
            const hours = Number(colon[1] || 0);
            const minutes = Number(colon[2] || 0);
            const seconds = Number(colon[3] || 0) + Number(`0.${colon[4] || 0}`);
            return Math.round((hours * 3600 + minutes * 60 + seconds) * 100) / 100;
        }
        const chinese = text.match(/(?:(\d+(?:\.\d+)?)\s*分)?\s*(\d+(?:\.\d+)?)?\s*秒?/);
        if (chinese && (chinese[1] || chinese[2])) {
            return Math.round((Number(chinese[1] || 0) * 60 + Number(chinese[2] || 0)) * 100) / 100;
        }
        const parsed = Number(text.replace(/秒|s/g, '').trim());
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };

    const isSummaryRow = (account, nickname) => {
        const value = `${account} ${nickname}`;
        return /店铺汇总值|店铺平均值/.test(value);
    };

    const sanitizeRawRow = (row) => Object.fromEntries(
        Object.entries(row || {}).filter(([key]) => {
            const normalized = cleanText(key);
            return normalized && !normalized.startsWith('__EMPTY');
        })
    );

    const normalizeRow = (row, index) => {
        const account = cleanText(row[CORE_HEADERS.account]);
        const nickname = cleanText(row[CORE_HEADERS.nickname]);
        if (isSummaryRow(account, nickname) || (!account && !nickname)) return null;
        const displayName = nickname || account;
        const sourceAccount = account || `昵称:${displayName}`;
        const warnings = [];
        if (!account) warnings.push('缺少客服账号，暂以昵称作为稳定标识');

        return {
            key: sourceAccount.toLocaleLowerCase('zh-CN'),
            sourceAccount,
            displayName,
            team: '',
            platform: '',
            sourceRowNumber: index + 2,
            goodCount: toCount(row[CORE_HEADERS.good]),
            badCount: toCount(row[CORE_HEADERS.bad]),
            avgResponseSeconds: parseDurationSeconds(row[CORE_HEADERS.response]),
            inquiryCount: toCount(row[CORE_HEADERS.inquiries]),
            orderCount: toCount(row[CORE_HEADERS.orders]),
            refundedSales: toNumber(row[CORE_HEADERS.refundedSales]),
            warnings,
            rawData: sanitizeRawRow(row)
        };
    };

    const parseRows = (rows) => {
        const agents = [];
        const seen = new Set();
        (rows || []).forEach((row, index) => {
            const agent = normalizeRow(row, index);
            if (!agent) return;
            let key = agent.key;
            if (seen.has(key)) {
                key = `${key}#${agent.sourceRowNumber}`;
                agent.key = key;
                agent.warnings.push('文件中出现重复人员标识，请确认是否应合并');
            }
            seen.add(key);
            agents.push(agent);
        });
        return agents;
    };

    const parseWorkbook = (arrayBuffer, XLSX) => {
        if (!XLSX || !XLSX.read || !XLSX.utils) throw new Error('SheetJS 未加载');
        const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('Excel 中没有可读取的工作表');
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: true });
        return { sheetName, rawRowCount: rows.length, agents: parseRows(rows) };
    };

    const satisfactionPoints = (rate) => {
        if (rate == null) return null;
        if (rate >= 0.92) return 110;
        if (rate >= 0.90) return 100;
        if (rate >= 0.88) return 80;
        if (rate >= 0.86) return 60;
        return 0;
    };

    const conversionPoints = (rate) => {
        if (rate == null) return null;
        if (rate >= 0.30) return 110;
        if (rate >= 0.25) return 100;
        if (rate >= 0.23) return 80;
        if (rate >= 0.20) return 60;
        return 30;
    };

    const responsePoints = (seconds) => {
        if (seconds == null) return null;
        if (seconds <= 15) return 110;
        if (seconds <= 18) return 100;
        if (seconds <= 21) return 80;
        return 0;
    };

    const calculateAgent = (agent) => {
        const goodCount = agent.goodCount;
        const badCount = agent.badCount;
        const inquiryCount = agent.inquiryCount;
        const orderCount = agent.orderCount;
        const ratingTotal = goodCount != null && badCount != null ? goodCount + badCount : null;
        const satisfactionRate = ratingTotal > 0 ? goodCount / ratingTotal : null;
        const conversionRate = inquiryCount > 0 && orderCount != null ? orderCount / inquiryCount : null;
        const satPoints = satisfactionPoints(satisfactionRate);
        const convPoints = conversionPoints(conversionRate);
        const respPoints = responsePoints(agent.avgResponseSeconds);
        const validation = [...(agent.warnings || [])];

        if (goodCount == null || badCount == null) validation.push('好评数或差评数不是有效非负数字');
        else if (ratingTotal <= 0) validation.push('有效评价数为 0，无法计算满意率');
        if (agent.avgResponseSeconds == null) validation.push('工作时间平响时长无法识别');
        if (inquiryCount == null || orderCount == null) validation.push('询单人数或下单人数不是有效非负数字');
        else if (inquiryCount <= 0) validation.push('询单人数为 0，无法计算转化率');
        else if (orderCount > inquiryCount) validation.push('下单人数大于询单人数');

        const totalScore = [satPoints, convPoints, respPoints].every((value) => value != null)
            ? Math.round((satPoints * RULES.weights.satisfaction + convPoints * RULES.weights.conversion + respPoints * RULES.weights.response) * 100) / 100
            : null;

        return {
            ...agent,
            satisfactionRate,
            conversionRate,
            satisfactionPoints: satPoints,
            conversionPoints: convPoints,
            responsePoints: respPoints,
            totalScore,
            validation,
            isValid: validation.filter((item) => !item.startsWith('缺少客服账号')).length === 0
        };
    };

    const rankAgents = (metrics) => [...(metrics || [])]
        .filter((item) => item.totalScore != null)
        .sort((a, b) =>
            b.totalScore - a.totalScore ||
            (b.satisfactionRate ?? -1) - (a.satisfactionRate ?? -1) ||
            (b.conversionRate ?? -1) - (a.conversionRate ?? -1) ||
            (a.avgResponseSeconds ?? Number.POSITIVE_INFINITY) - (b.avgResponseSeconds ?? Number.POSITIVE_INFINITY) ||
            a.displayName.localeCompare(b.displayName, 'zh-CN')
        )
        .map((item, index, list) => ({ ...item, rankPosition: index + 1, participantCount: list.length }));

    const calculateTeam = (metrics) => {
        const valid = (metrics || []).filter(Boolean);
        const good = valid.reduce((sum, item) => sum + (item.goodCount || 0), 0);
        const bad = valid.reduce((sum, item) => sum + (item.badCount || 0), 0);
        const inquiries = valid.reduce((sum, item) => sum + (item.inquiryCount || 0), 0);
        const orders = valid.reduce((sum, item) => sum + (item.orderCount || 0), 0);
        const responses = valid.map((item) => item.avgResponseSeconds).filter((value) => value != null);
        const scores = valid.map((item) => item.totalScore).filter((value) => value != null);
        return {
            participantCount: valid.length,
            goodCount: good,
            badCount: bad,
            inquiryCount: inquiries,
            orderCount: orders,
            satisfactionRate: good + bad > 0 ? good / (good + bad) : null,
            conversionRate: inquiries > 0 ? orders / inquiries : null,
            avgResponseSeconds: responses.length ? responses.reduce((a, b) => a + b, 0) / responses.length : null,
            avgTotalScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
            allTargetsCount: valid.filter((item) =>
                item.satisfactionRate >= RULES.targets.satisfaction &&
                item.conversionRate >= RULES.targets.conversion &&
                item.avgResponseSeconds <= RULES.targets.responseSeconds
            ).length
        };
    };

    const metricDate = (item) => item?.business_date || item?.businessDate || '';

    const normalizeStoredMetric = (item) => {
        const agent = item?.bi_agents || item?.agent || {};
        const agentId = item?.agent_id || item?.agentId || agent.id || null;
        const sourceAccount = cleanText(
            item?.source_account || item?.sourceAccount || agent.source_account || agent.sourceAccount || agentId
        );
        const displayName = cleanText(
            item?.display_name || item?.displayName || agent.display_name || agent.displayName || sourceAccount
        );
        const numberOrNull = (...values) => {
            const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '');
            return value === undefined ? null : toNumber(value);
        };
        return {
            businessDate: metricDate(item),
            agentId,
            sourceAccount,
            displayName,
            team: cleanText(item?.team || agent.team),
            platform: cleanText(item?.platform || agent.platform),
            goodCount: numberOrNull(item?.good_count, item?.goodCount),
            badCount: numberOrNull(item?.bad_count, item?.badCount),
            inquiryCount: numberOrNull(item?.inquiry_count, item?.inquiryCount),
            orderCount: numberOrNull(item?.order_count, item?.orderCount),
            avgResponseSeconds: numberOrNull(item?.avg_response_seconds, item?.avgResponseSeconds)
            ,refundedSales: numberOrNull(item?.refunded_sales, item?.refundedSales, item?.raw_data?.[CORE_HEADERS.refundedSales])
        };
    };

    const uniqueBusinessDates = (dates) => [...new Set((dates || []).filter(Boolean))].sort();

    const aggregateAgentMetrics = (metrics, dates) => {
        const dateSet = new Set(uniqueBusinessDates(dates));
        const groups = new Map();

        (metrics || []).map(normalizeStoredMetric).forEach((item) => {
            if (!item.businessDate || (dateSet.size && !dateSet.has(item.businessDate))) return;
            const key = item.agentId || item.sourceAccount.toLocaleLowerCase('zh-CN');
            if (!key) return;
            if (!groups.has(key)) {
                groups.set(key, {
                    agentId: item.agentId,
                    sourceAccount: item.sourceAccount,
                    displayName: item.displayName,
                    team: item.team,
                    platform: item.platform,
                    dates: new Set(),
                    goodCount: 0,
                    badCount: 0,
                    inquiryCount: 0,
                    orderCount: 0,
                    ratingDays: 0,
                    conversionDays: 0,
                    responses: []
                    ,sales: []
                });
            }
            const group = groups.get(key);
            group.dates.add(item.businessDate);
            if (item.goodCount != null && item.badCount != null) {
                group.goodCount += item.goodCount;
                group.badCount += item.badCount;
                group.ratingDays += 1;
            }
            if (item.inquiryCount != null && item.orderCount != null) {
                group.inquiryCount += item.inquiryCount;
                group.orderCount += item.orderCount;
                group.conversionDays += 1;
            }
            if (item.avgResponseSeconds != null) group.responses.push(item.avgResponseSeconds);
            if (item.refundedSales != null) group.sales.push(item.refundedSales);
        });

        return [...groups.values()].map((group) => {
            const metric = calculateAgent({
                agentId: group.agentId,
                sourceAccount: group.sourceAccount,
                displayName: group.displayName,
                team: group.team,
                platform: group.platform,
                goodCount: group.ratingDays ? group.goodCount : null,
                badCount: group.ratingDays ? group.badCount : null,
                inquiryCount: group.conversionDays ? group.inquiryCount : null,
                orderCount: group.conversionDays ? group.orderCount : null,
                avgResponseSeconds: group.responses.length
                    ? group.responses.reduce((sum, value) => sum + value, 0) / group.responses.length
                    : null,
                warnings: []
            });
            return {
                ...metric,
                participationDays: group.dates.size,
                ratingParticipationDays: group.ratingDays,
                conversionParticipationDays: group.conversionDays,
                responseParticipationDays: group.responses.length,
                refundedSalesTotal: group.sales.reduce((sum, value) => sum + value, 0),
                refundedSalesDays: group.sales.length,
                avgRefundedSales: group.sales.length ? group.sales.reduce((sum, value) => sum + value, 0) / group.sales.length : null,
                businessDates: [...group.dates].sort()
            };
        });
    };

    const aggregateTeamMetrics = (metrics, dates) => {
        const dateSet = new Set(uniqueBusinessDates(dates));
        const rows = (metrics || []).map(normalizeStoredMetric).filter((item) =>
            item.businessDate && (!dateSet.size || dateSet.has(item.businessDate))
        );
        const validRatings = rows.filter((item) => item.goodCount != null && item.badCount != null);
        const validConversions = rows.filter((item) => item.inquiryCount != null && item.orderCount != null);
        const responses = rows.map((item) => item.avgResponseSeconds).filter((value) => value != null);
        const goodCount = validRatings.reduce((sum, item) => sum + item.goodCount, 0);
        const badCount = validRatings.reduce((sum, item) => sum + item.badCount, 0);
        const inquiryCount = validConversions.reduce((sum, item) => sum + item.inquiryCount, 0);
        const orderCount = validConversions.reduce((sum, item) => sum + item.orderCount, 0);
        const aggregate = calculateAgent({
            sourceAccount: 'team',
            displayName: '团队',
            goodCount: validRatings.length ? goodCount : null,
            badCount: validRatings.length ? badCount : null,
            inquiryCount: validConversions.length ? inquiryCount : null,
            orderCount: validConversions.length ? orderCount : null,
            avgResponseSeconds: responses.length
                ? responses.reduce((sum, value) => sum + value, 0) / responses.length
                : null,
            warnings: []
        });
        const people = aggregateAgentMetrics(rows, dates);
        return {
            ...aggregate,
            participantCount: people.length,
            businessDayCount: uniqueBusinessDates(rows.map((item) => item.businessDate)).length,
            personDayCount: rows.length,
            avgTotalScore: aggregate.totalScore,
            allTargetsCount: people.filter((item) =>
                item.satisfactionRate >= RULES.targets.satisfaction &&
                item.conversionRate >= RULES.targets.conversion &&
                item.avgResponseSeconds <= RULES.targets.responseSeconds
            ).length
        };
    };

    const previousMonthKey = (monthKey) => {
        const [year, month] = monthKey.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 2, 1));
        return date.toISOString().slice(0, 7);
    };

    const resolvePeriodScope = (dates, period = 'yesterday', baseDate = null) => {
        const sorted = uniqueBusinessDates(dates).filter((date) => !baseDate || date <= baseDate);
        if (!sorted.length) {
            return {
                period,
                baseDate: null,
                currentDates: [],
                previousDates: [],
                comparisonComplete: false,
                minimumParticipationDays: period === 'last7' ? 2 : period === 'month' ? 3 : 1,
                provisional: false
            };
        }
        const latest = baseDate && sorted.includes(baseDate) ? baseDate : sorted.at(-1);
        const latestIndex = sorted.indexOf(latest);
        if (period === 'last7') {
            const currentStart = Math.max(0, latestIndex - 6);
            const currentDates = sorted.slice(currentStart, latestIndex + 1);
            const previousDates = sorted.slice(Math.max(0, currentStart - 7), currentStart);
            return {
                period,
                baseDate: latest,
                currentDates,
                previousDates,
                comparisonComplete: previousDates.length === 7,
                minimumParticipationDays: 2,
                provisional: false
            };
        }
        if (period === 'month') {
            const monthKey = latest.slice(0, 7);
            const cutoffDay = Number(latest.slice(8, 10));
            const priorKey = previousMonthKey(monthKey);
            const currentDates = sorted.filter((date) => date.startsWith(monthKey));
            const previousDates = sorted.filter((date) =>
                date.startsWith(priorKey) && Number(date.slice(8, 10)) <= cutoffDay
            );
            return {
                period,
                baseDate: latest,
                monthKey,
                previousMonthKey: priorKey,
                currentDates,
                previousDates,
                comparisonComplete: previousDates.length > 0,
                minimumParticipationDays: Math.max(3, Math.ceil(currentDates.length * 0.5)),
                provisional: currentDates.length > 0 && currentDates.length <= 2
            };
        }
        return {
            period: 'yesterday',
            baseDate: latest,
            currentDates: [latest],
            previousDates: latestIndex > 0 ? [sorted[latestIndex - 1]] : [],
            comparisonComplete: latestIndex > 0,
            minimumParticipationDays: 1,
            provisional: false
        };
    };

    const buildPeriodRanking = (metrics, dates, minimumParticipationDays = 1, provisional = false) => {
        const allRows = rankAgents(aggregateAgentMetrics(metrics, dates)).map((item) => ({
            ...item,
            isQualified: item.participationDays >= minimumParticipationDays,
            isProvisional: provisional
        }));
        const formalRows = provisional
            ? []
            : rankAgents(allRows.filter((item) => item.isQualified)).map((item) => ({ ...item, formalRankPosition: item.rankPosition }));
        const formalRankByKey = new Map(formalRows.map((item) => [item.agentId || item.sourceAccount, item.formalRankPosition]));
        return {
            allRows: allRows.map((item) => ({
                ...item,
                formalRankPosition: formalRankByKey.get(item.agentId || item.sourceAccount) || null
            })),
            formalRows,
            minimumParticipationDays,
            provisional
        };
    };

    const startOfISOWeek = (dateText) => {
        const date = new Date(`${dateText}T00:00:00Z`);
        const day = date.getUTCDay() || 7;
        date.setUTCDate(date.getUTCDate() - day + 1);
        return date.toISOString().slice(0, 10);
    };

    const aggregateHistory = (metrics, period) => {
        const groups = new Map();
        (metrics || []).forEach((item) => {
            const date = item.business_date || item.businessDate;
            if (!date) return;
            const key = period === 'month' ? date.slice(0, 7) : period === 'week' ? startOfISOWeek(date) : date;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({
                goodCount: Number(item.good_count ?? item.goodCount ?? 0),
                badCount: Number(item.bad_count ?? item.badCount ?? 0),
                inquiryCount: Number(item.inquiry_count ?? item.inquiryCount ?? 0),
                orderCount: Number(item.order_count ?? item.orderCount ?? 0),
                avgResponseSeconds: item.avg_response_seconds == null ? item.avgResponseSeconds : Number(item.avg_response_seconds),
                totalScore: item.total_score == null ? item.totalScore : Number(item.total_score)
            });
        });
        return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ key, ...calculateTeam(rows) }));
    };

    return {
        RULES,
        CORE_HEADERS,
        parseDurationSeconds,
        sanitizeRawRow,
        normalizeRow,
        parseRows,
        parseWorkbook,
        satisfactionPoints,
        conversionPoints,
        responsePoints,
        calculateAgent,
        rankAgents,
        calculateTeam,
        normalizeStoredMetric,
        uniqueBusinessDates,
        aggregateAgentMetrics,
        aggregateTeamMetrics,
        resolvePeriodScope,
        buildPeriodRanking,
        aggregateHistory
    };
});
