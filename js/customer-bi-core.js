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
        orders: '下单人数'
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
            return normalized && !normalized.startsWith('__EMPTY') && !normalized.includes('微信小店');
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
        aggregateHistory
    };
});
