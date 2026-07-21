(function startCustomerBI() {
    const {
        createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick
    } = Vue;
    const core = window.CustomerBICore;
    const db = window.customerBISupabase;

    const AnimatedNumber = {
        props: {
            value: { type: Number, default: null },
            decimals: { type: Number, default: 1 },
            suffix: { type: String, default: '' }
        },
        setup(props) {
            const shown = ref(props.value);
            let animationFrame = 0;
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const animate = (next, previous) => {
                cancelAnimationFrame(animationFrame);
                if (next == null) { shown.value = null; return; }
                const target = Number(next);
                const start = previous == null || !Number.isFinite(Number(previous)) ? 0 : Number(previous);
                if (reduceMotion) { shown.value = target; return; }
                const startTime = performance.now();
                const duration = 260;
                const tick = (time) => {
                    const progress = Math.min(1, (time - startTime) / duration);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    shown.value = start + (target - start) * eased;
                    if (progress < 1) animationFrame = requestAnimationFrame(tick);
                };
                animationFrame = requestAnimationFrame(tick);
            };
            watch(() => props.value, animate, { immediate: true });
            onBeforeUnmount(() => cancelAnimationFrame(animationFrame));
            const text = computed(() => shown.value == null || !Number.isFinite(Number(shown.value))
                ? '—'
                : `${Number(shown.value).toFixed(props.decimals)}${props.suffix}`);
            return { text };
        },
        template: '<strong class="animated-number">{{ text }}</strong>'
    };

    const app = createApp({
        setup() {
            const today = new Date().toISOString().slice(0, 10);
            const rules = core.RULES;
            const view = ref(location.hash === '#import' ? 'import' : 'dashboard');
            const steps = ['上传文件', '选择日期', '选择人员', '校验预览', '确认保存'];
            const importStep = ref(1);
            const fileInfo = ref(null);
            const fileHash = ref('');
            const parseError = ref('');
            const isParsing = ref(false);
            const isDragging = ref(false);
            const parsedAgents = ref([]);
            const selectedAccounts = ref([]);
            const agentSearch = ref('');
            const businessDate = ref(today);
            const isSaving = ref(false);

            const session = ref(null);
            const showAuth = ref(false);
            const authMode = ref('login');
            const authLoading = ref(false);
            const authForm = reactive({ email: '', password: '' });
            const pendingSaveAfterAuth = ref(false);
            const duplicateBatch = ref(null);
            const toasts = ref([]);

            const dashboardLoading = ref(false);
            const dashboardMetrics = ref([]);
            const dashboardRankings = ref([]);
            const dashboardDate = ref('');
            const trendPeriod = ref('day');
            const rankingMetric = ref('total');
            const trendChartEl = ref(null);
            const detailChartEl = ref(null);
            const detailAgent = ref(null);
            let trendChart = null;
            let detailChart = null;
            let authSubscription = null;

            const periodOptions = [
                { label: '日', value: 'day' }, { label: '周', value: 'week' }, { label: '月', value: 'month' }
            ];
            const rankingOptions = [
                { label: '综合', value: 'total' }, { label: '满意率', value: 'satisfaction' },
                { label: '均响', value: 'response' }, { label: '转化率', value: 'conversion' }
            ];

            const addToast = (message, type = 'info') => {
                const id = `${Date.now()}-${Math.random()}`;
                toasts.value.push({ id, message, type });
                window.setTimeout(() => {
                    toasts.value = toasts.value.filter((item) => item.id !== id);
                }, 3600);
            };

            const formatBytes = (bytes) => {
                if (!Number.isFinite(Number(bytes))) return '—';
                if (bytes < 1024) return `${bytes} B`;
                return `${(bytes / 1024).toFixed(1)} KB`;
            };
            const formatPercent = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
            const percentValue = (value) => value == null ? null : Number(value) * 100;
            const formatSeconds = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)} 秒`;
            const formatScore = (value) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1);

            const filteredAgents = computed(() => {
                const keyword = agentSearch.value.toLocaleLowerCase('zh-CN');
                if (!keyword) return parsedAgents.value;
                return parsedAgents.value.filter((agent) =>
                    `${agent.displayName} ${agent.sourceAccount}`.toLocaleLowerCase('zh-CN').includes(keyword)
                );
            });
            const selectedSet = computed(() => new Set(selectedAccounts.value));
            const isSelected = (agent) => selectedSet.value.has(agent.key);
            const toggleAgent = (agent) => {
                const next = new Set(selectedAccounts.value);
                if (next.has(agent.key)) next.delete(agent.key); else next.add(agent.key);
                selectedAccounts.value = [...next];
            };
            const selectFiltered = () => {
                selectedAccounts.value = [...new Set([...selectedAccounts.value, ...filteredAgents.value.map((agent) => agent.key)])];
            };
            const clearFiltered = () => {
                const visible = new Set(filteredAgents.value.map((agent) => agent.key));
                selectedAccounts.value = selectedAccounts.value.filter((key) => !visible.has(key));
            };
            const invertFiltered = () => {
                const next = new Set(selectedAccounts.value);
                filteredAgents.value.forEach((agent) => next.has(agent.key) ? next.delete(agent.key) : next.add(agent.key));
                selectedAccounts.value = [...next];
            };

            const selectedAgents = computed(() => parsedAgents.value.filter((agent) => selectedSet.value.has(agent.key)));
            const previewMetrics = computed(() => selectedAgents.value.map(core.calculateAgent));
            const previewRanking = computed(() => core.rankAgents(previewMetrics.value));
            const previewTeam = computed(() => core.calculateTeam(previewMetrics.value));
            const validationRows = computed(() => previewMetrics.value.filter((person) => person.validation.length));
            const hasBlockingValidation = computed(() => previewMetrics.value.some((person) => !person.isValid));
            const canContinue = computed(() => {
                if (importStep.value === 1) return !!fileInfo.value && !!parsedAgents.value.length && !parseError.value && !isParsing.value;
                if (importStep.value === 2) return /^\d{4}-\d{2}-\d{2}$/.test(businessDate.value);
                if (importStep.value === 3) return selectedAccounts.value.length > 0;
                if (importStep.value === 4) return !hasBlockingValidation.value && previewMetrics.value.length > 0;
                return false;
            });

            const previewPercent = (agent) => formatPercent(core.calculateAgent(agent).satisfactionRate);
            const previewConversion = (agent) => formatPercent(core.calculateAgent(agent).conversionRate);

            const createHash = async (buffer) => {
                if (!window.crypto?.subtle) return '';
                const digest = await window.crypto.subtle.digest('SHA-256', buffer);
                return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
            };

            const parseFile = async (file) => {
                parseError.value = '';
                if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
                    parseError.value = '请选择 .xlsx 或 .xls 文件';
                    return;
                }
                isParsing.value = true;
                parsedAgents.value = [];
                selectedAccounts.value = [];
                try {
                    const buffer = await file.arrayBuffer();
                    const [result, hash] = await Promise.all([
                        Promise.resolve(core.parseWorkbook(buffer, window.XLSX)),
                        createHash(buffer)
                    ]);
                    if (!result.agents.length) throw new Error('未识别到客服人员，请检查表头');
                    fileInfo.value = { name: file.name, size: file.size, sheetName: result.sheetName, rawRowCount: result.rawRowCount };
                    fileHash.value = hash;
                    parsedAgents.value = result.agents;
                    addToast(`已从 ${result.sheetName} 识别 ${result.agents.length} 名人员`, 'success');
                } catch (error) {
                    parseError.value = `解析失败：${error.message || error}`;
                    fileInfo.value = null;
                    addToast(parseError.value, 'error');
                } finally {
                    isParsing.value = false;
                }
            };
            const handleFileInput = (event) => parseFile(event.target.files?.[0]);
            const handleDrop = (event) => {
                isDragging.value = false;
                parseFile(event.dataTransfer?.files?.[0]);
            };

            const nextStep = () => {
                if (!canContinue.value) return;
                importStep.value = Math.min(5, importStep.value + 1);
            };
            const previousStep = () => { importStep.value = Math.max(1, importStep.value - 1); };
            const setView = (next) => {
                view.value = next;
                history.replaceState(null, '', next === 'import' ? '#import' : '#dashboard');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            const openImport = () => setView('import');
            const openDashboard = () => {
                setView('dashboard');
                nextTick(renderTrendChart);
            };

            const describeError = (error) => {
                const message = error?.message || String(error || '未知错误');
                if (/relation .* does not exist|schema cache/i.test(message)) return '数据库尚未初始化，请先运行 supabase/customer-bi-v1.sql';
                if (/row-level security|permission denied/i.test(message)) return '数据库拒绝写入，请确认已登录并已运行完整 SQL';
                return message;
            };

            const submitAuth = async () => {
                if (!db) { addToast('Supabase 客户端未加载', 'error'); return; }
                if (!authForm.email || authForm.password.length < 6) { addToast('请输入有效邮箱和至少 6 位密码', 'error'); return; }
                authLoading.value = true;
                try {
                    const result = authMode.value === 'login'
                        ? await db.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
                        : await db.auth.signUp({ email: authForm.email, password: authForm.password });
                    if (result.error) throw result.error;
                    if (result.data.session) {
                        session.value = result.data.session;
                        showAuth.value = false;
                        addToast(authMode.value === 'login' ? '登录成功' : '注册并登录成功', 'success');
                        await loadDashboard();
                        if (pendingSaveAfterAuth.value) { pendingSaveAfterAuth.value = false; await requestSave(); }
                    } else {
                        addToast('注册成功，请先在邮箱中完成确认后再登录', 'success');
                        authMode.value = 'login';
                    }
                } catch (error) {
                    addToast(describeError(error), 'error');
                } finally {
                    authLoading.value = false;
                }
            };
            const signOut = async () => {
                if (db) await db.auth.signOut();
                session.value = null;
                showAuth.value = false;
                dashboardMetrics.value = [];
                dashboardRankings.value = [];
                dashboardDate.value = '';
                addToast('已退出 Customer BI', 'info');
            };

            const loadDashboard = async () => {
                if (!db || !session.value) {
                    dashboardMetrics.value = [];
                    dashboardRankings.value = [];
                    return;
                }
                dashboardLoading.value = true;
                try {
                    const [metricResult, rankingResult] = await Promise.all([
                        db.from('bi_daily_metrics')
                            .select('*, bi_agents(id, source_account, display_name)')
                            .order('business_date', { ascending: true }),
                        db.from('bi_daily_rankings')
                            .select('*, bi_agents(id, source_account, display_name)')
                            .order('business_date', { ascending: true })
                    ]);
                    if (metricResult.error) throw metricResult.error;
                    if (rankingResult.error) throw rankingResult.error;
                    dashboardMetrics.value = metricResult.data || [];
                    dashboardRankings.value = rankingResult.data || [];
                    const dates = [...new Set(dashboardMetrics.value.map((item) => item.business_date))].sort();
                    if (dates.length && !dates.includes(dashboardDate.value)) dashboardDate.value = dates.at(-1);
                    await nextTick();
                    renderTrendChart();
                } catch (error) {
                    addToast(describeError(error), 'error');
                    dashboardMetrics.value = [];
                    dashboardRankings.value = [];
                } finally {
                    dashboardLoading.value = false;
                }
            };

            const availableDates = computed(() => [...new Set(dashboardMetrics.value.map((item) => item.business_date))].sort().reverse());
            const rankingLookup = computed(() => {
                const map = new Map();
                dashboardRankings.value.forEach((item) => map.set(`${item.business_date}:${item.agent_id}`, item));
                return map;
            });
            const currentMetrics = computed(() => dashboardMetrics.value
                .filter((item) => item.business_date === dashboardDate.value)
                .map((item) => {
                    const ranking = rankingLookup.value.get(`${item.business_date}:${item.agent_id}`);
                    return {
                        agentId: item.agent_id,
                        sourceAccount: item.bi_agents?.source_account || '',
                        displayName: item.bi_agents?.display_name || '未命名客服',
                        businessDate: item.business_date,
                        goodCount: Number(item.good_count || 0),
                        badCount: Number(item.bad_count || 0),
                        satisfactionRate: item.satisfaction_rate == null ? null : Number(item.satisfaction_rate),
                        satisfactionPoints: item.satisfaction_points == null ? null : Number(item.satisfaction_points),
                        inquiryCount: Number(item.inquiry_count || 0),
                        orderCount: Number(item.order_count || 0),
                        conversionRate: item.conversion_rate == null ? null : Number(item.conversion_rate),
                        conversionPoints: item.conversion_points == null ? null : Number(item.conversion_points),
                        avgResponseSeconds: item.avg_response_seconds == null ? null : Number(item.avg_response_seconds),
                        responsePoints: item.response_points == null ? null : Number(item.response_points),
                        totalScore: item.total_score == null ? null : Number(item.total_score),
                        rankPosition: ranking?.rank_position || null,
                        participantCount: ranking?.participant_count || null,
                        previousRank: ranking?.previous_rank || null
                    };
                }));
            const currentTeam = computed(() => core.calculateTeam(currentMetrics.value));
            const rankedByTotal = computed(() => core.rankAgents(currentMetrics.value).map((item) => {
                const original = currentMetrics.value.find((row) => row.agentId === item.agentId);
                return { ...item, previousRank: original?.previousRank ?? null };
            }));
            const rankingRows = computed(() => {
                const rows = [...currentMetrics.value];
                if (rankingMetric.value === 'satisfaction') rows.sort((a, b) => (b.satisfactionRate ?? -1) - (a.satisfactionRate ?? -1));
                else if (rankingMetric.value === 'conversion') rows.sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1));
                else if (rankingMetric.value === 'response') rows.sort((a, b) => (a.avgResponseSeconds ?? Infinity) - (b.avgResponseSeconds ?? Infinity));
                else return rankedByTotal.value;
                return rows;
            });
            const rankingValue = (person) => {
                if (rankingMetric.value === 'satisfaction') return formatPercent(person.satisfactionRate);
                if (rankingMetric.value === 'conversion') return formatPercent(person.conversionRate);
                if (rankingMetric.value === 'response') return formatSeconds(person.avgResponseSeconds);
                return formatScore(person.totalScore);
            };
            const rankChangeText = (person) => {
                if (!person.previousRank) return 'NEW';
                if (person.previousRank > person.rankPosition) return `↑${person.previousRank - person.rankPosition}`;
                if (person.previousRank < person.rankPosition) return `↓${person.rankPosition - person.previousRank}`;
                return '—';
            };
            const rankChangeClass = (person) => {
                if (!person.previousRank || person.previousRank === person.rankPosition) return 'flat';
                return person.previousRank > person.rankPosition ? 'up' : 'down';
            };
            const targetClass = (passed) => passed ? 'target-pass' : 'target-fail';

            const topInsight = computed(() => {
                const person = rankedByTotal.value[0];
                return person ? `${person.displayName} 综合得分 ${formatScore(person.totalScore)}，位列当日第一。` : '暂无数据。';
            });
            const riskInsight = computed(() => {
                const missed = currentMetrics.value.filter((item) => item.satisfactionRate < rules.targets.satisfaction);
                return missed.length ? `${missed.length} 人满意率低于 90%，需要优先复盘差评。` : '当前参与人员满意率全部达标。';
            });
            const movementInsight = computed(() => {
                const mover = rankedByTotal.value.filter((item) => item.previousRank && item.previousRank > item.rankPosition)
                    .sort((a, b) => (b.previousRank - b.rankPosition) - (a.previousRank - a.rankPosition))[0];
                return mover ? `${mover.displayName} 较上次参与提升 ${mover.previousRank - mover.rankPosition} 名。` : '暂无明显上升人员或缺少上一参与日数据。';
            });

            const renderTrendChart = () => {
                if (!trendChartEl.value || !window.echarts || view.value !== 'dashboard') return;
                if (!trendChart) trendChart = echarts.init(trendChartEl.value);
                const history = core.aggregateHistory(dashboardMetrics.value, trendPeriod.value);
                trendChart.setOption({
                    animationDuration: 250,
                    backgroundColor: 'transparent',
                    color: ['#38bdf8', '#18bd8b', '#f6a918'],
                    tooltip: { trigger: 'axis', backgroundColor: '#13223a', borderColor: '#2d4565', textStyle: { color: '#eaf4ff', fontSize: 11 } },
                    legend: { top: 2, right: 0, textStyle: { color: '#7e93ad', fontSize: 9 }, data: ['满意率', '转化率', '工作时间均响'] },
                    grid: { left: 34, right: 45, top: 44, bottom: 28 },
                    xAxis: { type: 'category', data: history.map((item) => item.key), boundaryGap: false, axisLine: { lineStyle: { color: '#2a3c57' } }, axisLabel: { color: '#6d829c', fontSize: 9 } },
                    yAxis: [
                        { type: 'value', min: 0, max: 100, axisLabel: { color: '#6d829c', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(134,158,187,.12)' } } },
                        { type: 'value', axisLabel: { color: '#6d829c', fontSize: 9, formatter: '{value}s' }, splitLine: { show: false } }
                    ],
                    series: [
                        { name: '满意率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: history.map((item) => item.satisfactionRate == null ? null : +(item.satisfactionRate * 100).toFixed(2)), lineStyle: { width: 3 }, areaStyle: { opacity: .05 } },
                        { name: '转化率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: history.map((item) => item.conversionRate == null ? null : +(item.conversionRate * 100).toFixed(2)), lineStyle: { width: 2 } },
                        { name: '工作时间均响', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'diamond', symbolSize: 6, data: history.map((item) => item.avgResponseSeconds == null ? null : +item.avgResponseSeconds.toFixed(2)), lineStyle: { width: 2, type: 'dashed' } }
                    ]
                }, true);
            };

            const detailHistory = computed(() => detailAgent.value
                ? dashboardMetrics.value.filter((item) => item.agent_id === detailAgent.value.agentId).sort((a, b) => a.business_date.localeCompare(b.business_date))
                : []);
            const renderDetailChart = () => {
                if (!detailChartEl.value || !detailAgent.value || !window.echarts) return;
                if (detailChart) detailChart.dispose();
                detailChart = echarts.init(detailChartEl.value);
                const rows = detailHistory.value;
                detailChart.setOption({
                    animationDuration: 250,
                    color: ['#2f7df6', '#18bd8b', '#f6a918'],
                    tooltip: { trigger: 'axis' },
                    legend: { top: 0, right: 0, textStyle: { color: '#73869a', fontSize: 9 } },
                    grid: { left: 36, right: 43, top: 43, bottom: 28 },
                    xAxis: { type: 'category', boundaryGap: false, data: rows.map((item) => item.business_date.slice(5)), axisLabel: { color: '#7c8da0', fontSize: 9 } },
                    yAxis: [{ type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', fontSize: 9 }, splitLine: { lineStyle: { color: '#e8eef4' } } }, { type: 'value', axisLabel: { formatter: '{value}s', fontSize: 9 }, splitLine: { show: false } }],
                    series: [
                        { name: '满意率', type: 'line', smooth: true, data: rows.map((item) => item.satisfaction_rate == null ? null : +(Number(item.satisfaction_rate) * 100).toFixed(2)) },
                        { name: '转化率', type: 'line', smooth: true, data: rows.map((item) => item.conversion_rate == null ? null : +(Number(item.conversion_rate) * 100).toFixed(2)) },
                        { name: '均响', type: 'line', smooth: true, yAxisIndex: 1, data: rows.map((item) => item.avg_response_seconds == null ? null : Number(item.avg_response_seconds)) }
                    ]
                });
            };
            const openAgent = (person) => {
                detailAgent.value = person;
                nextTick(renderDetailChart);
            };
            const closeAgent = () => {
                detailAgent.value = null;
                if (detailChart) { detailChart.dispose(); detailChart = null; }
            };

            const fetchPreviousRanks = async (agentIds) => {
                if (!agentIds.length) return new Map();
                const { data, error } = await db.from('bi_daily_rankings')
                    .select('agent_id, rank_position, business_date')
                    .in('agent_id', agentIds)
                    .lt('business_date', businessDate.value)
                    .order('business_date', { ascending: false });
                if (error) throw error;
                const map = new Map();
                (data || []).forEach((row) => { if (!map.has(row.agent_id)) map.set(row.agent_id, row.rank_position); });
                return map;
            };

            const requestSave = async () => {
                if (hasBlockingValidation.value) { addToast('仍有阻断性校验错误，请返回上一步处理', 'error'); return; }
                if (!session.value) {
                    pendingSaveAfterAuth.value = true;
                    showAuth.value = true;
                    addToast('登录后才能保存当天快照', 'info');
                    return;
                }
                isSaving.value = true;
                try {
                    const { data, error } = await db.from('bi_import_batches')
                        .select('id, business_date, file_name')
                        .eq('business_date', businessDate.value)
                        .maybeSingle();
                    if (error) throw error;
                    if (data) {
                        duplicateBatch.value = data;
                        isSaving.value = false;
                        return;
                    }
                    await saveBatch(false);
                } catch (error) {
                    isSaving.value = false;
                    addToast(describeError(error), 'error');
                }
            };

            const saveBatch = async (replaceExisting) => {
                if (!session.value || !db) return;
                isSaving.value = true;
                let newBatchId = null;
                try {
                    if (replaceExisting && duplicateBatch.value?.id) {
                        const { error } = await db.from('bi_import_batches').delete().eq('id', duplicateBatch.value.id);
                        if (error) throw error;
                    }
                    duplicateBatch.value = null;

                    const { data: batch, error: batchError } = await db.from('bi_import_batches').insert({
                        business_date: businessDate.value,
                        file_name: fileInfo.value.name,
                        file_hash: fileHash.value || null,
                        status: 'confirmed',
                        selected_count: previewMetrics.value.length,
                        excluded_count: parsedAgents.value.length - previewMetrics.value.length,
                        rules_snapshot: rules,
                        created_by: session.value.user.id
                    }).select('id').single();
                    if (batchError) throw batchError;
                    newBatchId = batch.id;

                    const agentPayload = previewMetrics.value.map((person) => ({
                        source_account: person.sourceAccount,
                        display_name: person.displayName,
                        team: person.team || null,
                        platform: person.platform || null,
                        is_active: true
                    }));
                    const { data: storedAgents, error: agentError } = await db.from('bi_agents')
                        .upsert(agentPayload, { onConflict: 'source_account' })
                        .select('id, source_account, display_name');
                    if (agentError) throw agentError;
                    const idByAccount = new Map((storedAgents || []).map((agent) => [agent.source_account, agent.id]));

                    const batchAgentPayload = parsedAgents.value.map((agent) => ({
                        batch_id: newBatchId,
                        agent_id: idByAccount.get(agent.sourceAccount) || null,
                        source_account: agent.sourceAccount,
                        display_name_snapshot: agent.displayName,
                        source_row_number: agent.sourceRowNumber,
                        is_included: selectedSet.value.has(agent.key),
                        raw_data: agent.rawData
                    }));
                    const { error: batchAgentError } = await db.from('bi_import_batch_agents').insert(batchAgentPayload);
                    if (batchAgentError) throw batchAgentError;

                    const ranked = previewRanking.value;
                    const agentIds = ranked.map((person) => idByAccount.get(person.sourceAccount)).filter(Boolean);
                    const previousRanks = await fetchPreviousRanks(agentIds);
                    const metricPayload = ranked.map((person) => ({
                        batch_id: newBatchId,
                        agent_id: idByAccount.get(person.sourceAccount),
                        business_date: businessDate.value,
                        good_count: person.goodCount,
                        bad_count: person.badCount,
                        satisfaction_rate: person.satisfactionRate,
                        satisfaction_points: person.satisfactionPoints,
                        inquiry_count: person.inquiryCount,
                        order_count: person.orderCount,
                        conversion_rate: person.conversionRate,
                        conversion_points: person.conversionPoints,
                        avg_response_seconds: person.avgResponseSeconds,
                        response_points: person.responsePoints,
                        total_score: person.totalScore
                    }));
                    const { error: metricError } = await db.from('bi_daily_metrics').insert(metricPayload);
                    if (metricError) throw metricError;

                    const rankingPayload = ranked.map((person) => {
                        const agentId = idByAccount.get(person.sourceAccount);
                        return {
                            batch_id: newBatchId,
                            agent_id: agentId,
                            business_date: businessDate.value,
                            rank_position: person.rankPosition,
                            participant_count: ranked.length,
                            total_score: person.totalScore,
                            previous_rank: previousRanks.get(agentId) || null
                        };
                    });
                    const { error: rankingError } = await db.from('bi_daily_rankings').insert(rankingPayload);
                    if (rankingError) throw rankingError;

                    const team = previewTeam.value;
                    const { error: teamError } = await db.from('bi_team_daily_summary').insert({
                        batch_id: newBatchId,
                        business_date: businessDate.value,
                        participant_count: team.participantCount,
                        satisfaction_rate: team.satisfactionRate,
                        conversion_rate: team.conversionRate,
                        avg_response_seconds: team.avgResponseSeconds,
                        avg_total_score: team.avgTotalScore
                    });
                    if (teamError) throw teamError;

                    addToast(`${businessDate.value} 快照保存成功`, 'success');
                    dashboardDate.value = businessDate.value;
                    await loadDashboard();
                    openDashboard();
                } catch (error) {
                    if (newBatchId) await db.from('bi_import_batches').delete().eq('id', newBatchId);
                    addToast(`保存失败：${describeError(error)}`, 'error');
                } finally {
                    isSaving.value = false;
                }
            };

            const handleResize = () => {
                trendChart?.resize();
                detailChart?.resize();
            };

            watch(trendPeriod, () => nextTick(renderTrendChart));
            watch(dashboardDate, () => nextTick(renderTrendChart));
            watch(dashboardMetrics, () => nextTick(renderTrendChart));

            onMounted(async () => {
                window.addEventListener('resize', handleResize);
                window.addEventListener('hashchange', () => { view.value = location.hash === '#import' ? 'import' : 'dashboard'; });
                if (!db) { addToast('Supabase SDK 或独立配置加载失败', 'error'); return; }
                const { data } = await db.auth.getSession();
                session.value = data.session;
                const listener = db.auth.onAuthStateChange(async (_event, nextSession) => {
                    session.value = nextSession;
                    if (nextSession) await loadDashboard();
                });
                authSubscription = listener.data.subscription;
                if (session.value) await loadDashboard();
            });
            onBeforeUnmount(() => {
                window.removeEventListener('resize', handleResize);
                authSubscription?.unsubscribe();
                trendChart?.dispose();
                detailChart?.dispose();
            });

            return {
                today, rules, view, steps, importStep, fileInfo, parseError, isParsing, isDragging,
                parsedAgents, selectedAccounts, agentSearch, businessDate, isSaving,
                session, showAuth, authMode, authLoading, authForm, duplicateBatch, toasts,
                dashboardLoading, dashboardDate, availableDates, trendPeriod, rankingMetric,
                periodOptions, rankingOptions, trendChartEl, detailChartEl, detailAgent, detailHistory,
                filteredAgents, previewMetrics, previewRanking, previewTeam, validationRows,
                hasBlockingValidation, canContinue, currentMetrics, currentTeam, rankedByTotal, rankingRows,
                topInsight, riskInsight, movementInsight,
                formatBytes, formatPercent, percentValue, formatSeconds, formatScore,
                previewPercent, previewConversion, isSelected, toggleAgent, selectFiltered, clearFiltered,
                invertFiltered, handleFileInput, handleDrop, nextStep, previousStep, openImport, openDashboard,
                loadDashboard, rankingValue, rankChangeText, rankChangeClass, targetClass, openAgent, closeAgent,
                submitAuth, signOut, requestSave, saveBatch
            };
        }
    });

    app.component('animated-number', AnimatedNumber);
    app.mount('#app');
})();
