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
            ,prefix: { type: String, default: '' }
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
                : `${props.prefix}${Number(shown.value).toFixed(props.decimals)}${props.suffix}`);
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
            const dashboardBatches = ref([]);
            const dashboardBatchAgents = ref([]);
            const dashboardPeriod = ref('yesterday');
            const customStart = ref('');
            const customEnd = ref('');
            const rankingMetric = ref('total');
            const trendChartEl = ref(null);
            const detailChartEl = ref(null);
            const detailAgent = ref(null);
            const detailPeriod = ref('yesterday');
            let trendChart = null;
            let detailChart = null;
            let authSubscription = null;
            let trendRenderFrame = 0;
            let detailRenderFrame = 0;

            const periodOptions = [
                { label: '昨日', value: 'yesterday' },
                { label: '近 7 日', value: 'last7' },
                { label: '本月', value: 'month' }, { label: '自定义', value: 'custom' }
            ];
            const noticeItems = ['数据仅统计已确认快照', '均响为工作时间平响时长', '上传前请确认业务日期'];
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
            const formatDateTime = (value) => {
                if (!value) return '—';
                const date = new Date(value);
                return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
            };

            const agentMetricPreview = (agent) => core.calculateAgent(agent);
            const isAgentSelectable = (agent) => agentMetricPreview(agent).satisfactionRate != null;

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
                if (!isAgentSelectable(agent)) return;
                const next = new Set(selectedAccounts.value);
                if (next.has(agent.key)) next.delete(agent.key); else next.add(agent.key);
                selectedAccounts.value = [...next];
            };
            const selectFiltered = () => {
                selectedAccounts.value = [...new Set([
                    ...selectedAccounts.value,
                    ...filteredAgents.value.filter(isAgentSelectable).map((agent) => agent.key)
                ])];
            };
            const clearFiltered = () => {
                const visible = new Set(filteredAgents.value.map((agent) => agent.key));
                selectedAccounts.value = selectedAccounts.value.filter((key) => !visible.has(key));
            };
            const invertFiltered = () => {
                const next = new Set(selectedAccounts.value);
                filteredAgents.value.filter(isAgentSelectable).forEach((agent) => next.has(agent.key) ? next.delete(agent.key) : next.add(agent.key));
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

            const previewPercent = (agent) => formatPercent(agentMetricPreview(agent).satisfactionRate);
            const previewConversion = (agent) => formatPercent(agentMetricPreview(agent).conversionRate);

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
            const handleFileInput = async (event) => {
                const input = event.target;
                await parseFile(input.files?.[0]);
                input.value = '';
            };
            const handleDrop = (event) => {
                isDragging.value = false;
                parseFile(event.dataTransfer?.files?.[0]);
            };

            const nextStep = () => {
                if (!canContinue.value) return;
                importStep.value = Math.min(5, importStep.value + 1);
            };
            const previousStep = () => { importStep.value = Math.max(1, importStep.value - 1); };
            const resetImport = () => {
                importStep.value = 1;
                fileInfo.value = null;
                fileHash.value = '';
                parseError.value = '';
                parsedAgents.value = [];
                selectedAccounts.value = [];
                agentSearch.value = '';
                businessDate.value = today;
                duplicateBatch.value = null;
            };
            const setView = (next) => {
                view.value = next;
                history.replaceState(null, '', next === 'import' ? '#import' : '#dashboard');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            const openImport = () => setView('import');
            const openDashboard = () => {
                setView('dashboard');
                scheduleTrendChart();
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
                dashboardBatches.value = [];
                dashboardBatchAgents.value = [];
                addToast('已退出 Customer BI', 'info');
            };

            const loadDashboard = async () => {
                if (!db || !session.value) {
                    dashboardMetrics.value = [];
                    dashboardRankings.value = [];
                    dashboardBatches.value = [];
                    dashboardBatchAgents.value = [];
                    return;
                }
                dashboardLoading.value = true;
                try {
                    const [batchResult, metricResult, rankingResult, batchAgentResult] = await Promise.all([
                        db.from('bi_import_batches')
                            .select('id, business_date, status, file_name, selected_count, excluded_count, confirmed_at, created_at')
                            .eq('status', 'confirmed')
                            .order('business_date', { ascending: true }),
                        db.from('bi_daily_metrics')
                            .select('*, bi_agents(id, source_account, display_name)')
                            .order('business_date', { ascending: true }),
                        db.from('bi_daily_rankings')
                            .select('*, bi_agents(id, source_account, display_name)')
                            .order('business_date', { ascending: true }),
                        db.from('bi_import_batch_agents')
                            .select('batch_id, agent_id, display_name_snapshot, is_included, raw_data')
                            .eq('is_included', true)
                    ]);
                    if (batchResult.error) throw batchResult.error;
                    if (metricResult.error) throw metricResult.error;
                    if (rankingResult.error) throw rankingResult.error;
                    if (batchAgentResult.error) throw batchAgentResult.error;
                    const normalizeDate = (value) => String(value || '').slice(0, 10);
                    dashboardBatches.value = (batchResult.data || []).map((item) => ({ ...item, business_date: normalizeDate(item.business_date) }));
                    const salesByBatchAgent = new Map((batchAgentResult.data || []).map((item) => [
                        `${item.batch_id}:${item.agent_id}`, Number(item.raw_data?.['退款后销售额'])
                    ]));
                    dashboardMetrics.value = (metricResult.data || []).map((item) => ({ ...item, business_date: normalizeDate(item.business_date), refunded_sales: Number.isFinite(salesByBatchAgent.get(`${item.batch_id}:${item.agent_id}`)) ? salesByBatchAgent.get(`${item.batch_id}:${item.agent_id}`) : null }));
                    dashboardRankings.value = (rankingResult.data || []).map((item) => ({ ...item, business_date: normalizeDate(item.business_date) }));
                    dashboardBatchAgents.value = batchAgentResult.data || [];
                } catch (error) {
                    addToast(describeError(error), 'error');
                    dashboardBatches.value = [];
                    dashboardMetrics.value = [];
                    dashboardRankings.value = [];
                    dashboardBatchAgents.value = [];
                } finally {
                    dashboardLoading.value = false;
                    await nextTick();
                    scheduleTrendChart();
                }
            };

            const importHistoryRows = computed(() => {
                const includedByBatch = new Map();
                dashboardBatchAgents.value.forEach((item) => {
                    if (!includedByBatch.has(item.batch_id)) includedByBatch.set(item.batch_id, []);
                    includedByBatch.get(item.batch_id).push(item.display_name_snapshot);
                });
                return [...dashboardBatches.value]
                    .sort((a, b) => b.business_date.localeCompare(a.business_date))
                    .slice(0, 12)
                    .map((batch) => ({ ...batch, includedNames: includedByBatch.get(batch.id) || [] }));
            });

            const availableDates = computed(() => {
                const metricDates = new Set(dashboardMetrics.value.map((item) => item.business_date));
                return core.uniqueBusinessDates(
                    dashboardBatches.value
                        .filter((item) => item.status === 'confirmed' && metricDates.has(item.business_date))
                        .map((item) => item.business_date)
                );
            });
            const rankingLookup = computed(() => {
                const map = new Map();
                dashboardRankings.value.forEach((item) => map.set(`${item.business_date}:${item.agent_id}`, item));
                return map;
            });
            const periodScope = computed(() => {
                if (dashboardPeriod.value !== 'custom') return core.resolvePeriodScope(availableDates.value, dashboardPeriod.value);
                const dates = availableDates.value.filter((date) => (!customStart.value || date >= customStart.value) && (!customEnd.value || date <= customEnd.value));
                const before = availableDates.value.filter((date) => dates.length && date < dates[0]).slice(-dates.length);
                return { currentDates: dates, previousDates: before, minimumParticipationDays: dates.length > 1 ? 2 : 1, provisional: false, comparisonComplete: !!dates.length && before.length === dates.length };
            });
            const currentPeriodRanking = computed(() => core.buildPeriodRanking(
                dashboardMetrics.value,
                periodScope.value.currentDates,
                periodScope.value.minimumParticipationDays,
                periodScope.value.provisional
            ));
            const previousPeriodRows = computed(() => core.rankAgents(
                core.aggregateAgentMetrics(dashboardMetrics.value, periodScope.value.previousDates)
            ));
            const previousRankMap = computed(() => new Map(previousPeriodRows.value.map((item) => [
                item.agentId || item.sourceAccount,
                item.rankPosition
            ])));
            const rankedByTotal = computed(() => {
                const currentDate = periodScope.value.currentDates[0];
                const rows = currentPeriodRanking.value.allRows.map((item) => {
                    const key = item.agentId || item.sourceAccount;
                    const official = dashboardPeriod.value === 'yesterday'
                        ? rankingLookup.value.get(`${currentDate}:${item.agentId}`)
                        : null;
                    return {
                        ...item,
                        rankPosition: official?.rank_position || item.rankPosition,
                        participantCount: currentPeriodRanking.value.allRows.length,
                        previousRank: periodScope.value.comparisonComplete ? previousRankMap.value.get(key) || null : null
                    };
                });
                return dashboardPeriod.value === 'yesterday'
                    ? rows.sort((a, b) => a.rankPosition - b.rankPosition)
                    : rows;
            });
            const currentMetrics = computed(() => rankedByTotal.value);
            const currentTeam = computed(() => core.aggregateTeamMetrics(dashboardMetrics.value, periodScope.value.currentDates));
            const previousTeam = computed(() => periodScope.value.previousDates.length
                ? core.aggregateTeamMetrics(dashboardMetrics.value, periodScope.value.previousDates)
                : null
            );
            const eligibleRows = computed(() => {
                if (periodScope.value.provisional) return [];
                return rankedByTotal.value.filter((item) => item.isQualified);
            });
            const currentChampion = computed(() => periodScope.value.provisional
                ? rankedByTotal.value[0] || null
                : eligibleRows.value[0] || null
            );
            const formatChineseDate = (date) => {
                if (!date) return '暂无日期';
                const [year, month, day] = date.split('-').map(Number);
                return `${year} 年 ${month} 月 ${day} 日`;
            };
            const periodName = computed(() => ({ yesterday: '昨日', last7: '近 7 日', month: '本月', custom: '自定义' }[dashboardPeriod.value]));
            const trendTitle = computed(() => dashboardPeriod.value === 'yesterday'
                ? '近期指标趋势 · 昨日重点'
                : `${periodName.value}指标趋势`
            );
            const periodRangeText = computed(() => {
                const dates = periodScope.value.currentDates;
                if (!dates.length) return '暂无已确认数据';
                if (dashboardPeriod.value === 'yesterday') return `昨日数据 · ${dates[0]}`;
                if (dashboardPeriod.value === 'month') {
                    const [year, month] = dates.at(-1).slice(0, 7).split('-').map(Number);
                    return `${year} 年 ${month} 月 · 已录入 ${dates.length} 个业务日`;
                }
                if (dashboardPeriod.value === 'custom') return dates.length === 1 ? `自定义日期 · ${dates[0]}` : `${dates[0]} 至 ${dates.at(-1)} · ${dates.length} 个有效业务日`;
                return `${dates[0]} 至 ${dates.at(-1)} · ${dates.length} 个有效业务日`;
            });
            const dashboardStatusText = computed(() => {
                if (!periodScope.value.currentDates.length) return '等待首个 confirmed 快照';
                if (dashboardPeriod.value === 'yesterday') return '正式日快照';
                if (periodScope.value.provisional) return '月度样本积累中 · 临时排行';
                return `由 ${periodScope.value.currentDates.length} 个 confirmed 快照实时聚合`;
            });
            const rankingTitle = computed(() => {
                const scope = '当前确认人员范围';
                if (!periodScope.value.currentDates.length) return '暂无排行榜';
                if (dashboardPeriod.value === 'yesterday') {
                    return `${periodScope.value.currentDates[0]} · ${scope} · 共 ${rankedByTotal.value.length} 人参与昨日排名`;
                }
                if (dashboardPeriod.value === 'month') {
                    const [year, month] = periodScope.value.currentDates.at(-1).slice(0, 7).split('-').map(Number);
                    return `${year} 年 ${month} 月 · ${scope} · 共 ${rankedByTotal.value.length} 人参与月排名`;
                }
                return `${periodScope.value.currentDates[0]} 至 ${periodScope.value.currentDates.at(-1)} · ${scope} · 共 ${rankedByTotal.value.length} 人参与近 7 日排名`;
            });
            const kpiComparison = (metric) => {
                if (!periodScope.value.comparisonComplete || !previousTeam.value) {
                    return { text: '暂无完整对比', state: 'neutral' };
                }
                const definitions = {
                    score: ['avgTotalScore', 1, ' 分', false],
                    satisfaction: ['satisfactionRate', 100, ' 个百分点', false],
                    response: ['avgResponseSeconds', 1, ' 秒', true],
                    conversion: ['conversionRate', 100, ' 个百分点', false],
                    targets: ['allTargetsCount', 1, ' 人', false]
                };
                const [field, multiplier, unit, lowerIsBetter] = definitions[metric];
                const current = currentTeam.value[field];
                const previous = previousTeam.value[field];
                if (current == null || previous == null) return { text: '暂无完整对比', state: 'neutral' };
                const delta = (Number(current) - Number(previous)) * multiplier;
                const state = Math.abs(delta) < 0.0001 ? 'neutral' : ((delta < 0) === lowerIsBetter ? 'positive' : 'negative');
                const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
                return { text: `${arrow} ${Math.abs(delta).toFixed(metric === 'targets' ? 0 : 1)}${unit}`, state };
            };
            const rankingRows = computed(() => {
                const rows = [...rankedByTotal.value];
                if (rankingMetric.value === 'satisfaction') rows.sort((a, b) => (b.satisfactionRate ?? -1) - (a.satisfactionRate ?? -1));
                else if (rankingMetric.value === 'conversion') rows.sort((a, b) => (b.conversionRate ?? -1) - (a.conversionRate ?? -1));
                else if (rankingMetric.value === 'response') rows.sort((a, b) => (a.avgResponseSeconds ?? Infinity) - (b.avgResponseSeconds ?? Infinity));
                if (periodScope.value.provisional) return rows;
                return [
                    ...rows.filter((item) => item.isQualified),
                    ...rows.filter((item) => !item.isQualified)
                ];
            });
            const attainment = computed(() => {
                const totals = { passed: 0, valid: 0, satisfaction: [0, 0], response: [0, 0], conversion: [0, 0] };
                rankedByTotal.value.forEach((person) => {
                    [['satisfaction', person.satisfactionRate, rules.targets.satisfaction, false], ['response', person.avgResponseSeconds, rules.targets.responseSeconds, true], ['conversion', person.conversionRate, rules.targets.conversion, false]].forEach(([key, value, target, lower]) => {
                        if (value == null) return;
                        totals.valid += 1; totals[key][1] += 1;
                        if (lower ? value <= target : value >= target) { totals.passed += 1; totals[key][0] += 1; }
                    });
                });
                return { ...totals, rate: totals.valid ? totals.passed / totals.valid : null };
            });
            const salesRows = computed(() => rankedByTotal.value.filter((item) => item.avgRefundedSales != null).sort((a, b) => b.avgRefundedSales - a.avgRefundedSales));
            const salesSummary = computed(() => ({ total: salesRows.value.reduce((sum, item) => sum + item.refundedSalesTotal, 0), days: salesRows.value.reduce((sum, item) => sum + item.refundedSalesDays, 0) }));
            const honorByAgent = computed(() => {
                const grouped = new Map();
                dashboardRankings.value.forEach((item) => {
                    if (!grouped.has(item.agent_id)) grouped.set(item.agent_id, []);
                    grouped.get(item.agent_id).push(item);
                });
                const result = new Map();
                grouped.forEach((items, agentId) => {
                    const rows = [...items].sort((a, b) => a.business_date.localeCompare(b.business_date));
                    let currentFirstStreak = 0;
                    for (let index = rows.length - 1; index >= 0 && rows[index].rank_position === 1; index -= 1) currentFirstStreak += 1;
                    let bestFirstStreak = 0;
                    let running = 0;
                    rows.forEach((row) => {
                        running = row.rank_position === 1 ? running + 1 : 0;
                        bestFirstStreak = Math.max(bestFirstStreak, running);
                    });
                    const firstRows = rows.filter((row) => row.rank_position === 1).reverse();
                    result.set(agentId, { currentFirstStreak, bestFirstStreak, firstRows });
                });
                return result;
            });
            const honorLabel = (person) => {
                const count = historicalFirstCount(person);
                if (count) return `${rankingOptions.find((item) => item.value === rankingMetric.value)?.label || '综合'}第一 ${count} 次`;
                const honor = honorByAgent.value.get(person.agentId); if (!honor) return '';
                if (honor.currentFirstStreak >= 2) return `连续 ${honor.currentFirstStreak} 个有效业务日第一`;
                if (honor.firstRows.length) return `历史第一 ${honor.firstRows.length} 次`;
                return '';
            };
            const historicalFirstCount = (person) => {
                const key = person.agentId || person.sourceAccount;
                return availableDates.value.reduce((count, date) => {
                    const rows = core.buildPeriodRanking(dashboardMetrics.value, [date], 1, false).allRows.filter((item) => item.isQualified);
                    rows.sort((a, b) => rankingMetric.value === 'response' ? (a.avgResponseSeconds ?? Infinity) - (b.avgResponseSeconds ?? Infinity) : rankingMetric.value === 'satisfaction' ? (b.satisfactionRate ?? -1) - (a.satisfactionRate ?? -1) : rankingMetric.value === 'conversion' ? (b.conversionRate ?? -1) - (a.conversionRate ?? -1) : (b.totalScore ?? -1) - (a.totalScore ?? -1));
                    return count + (rows[0] && (rows[0].agentId || rows[0].sourceAccount) === key ? 1 : 0);
                }, 0);
            };
            const rankingPositionText = (person, index) => person.isQualified || periodScope.value.provisional ? index + 1 : '—';
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
                const person = currentChampion.value;
                if (!person) return periodScope.value.provisional ? '月度样本积累中，当前只有临时排行。' : '暂无满足正式参与条件的人员。';
                const prefix = periodScope.value.provisional ? '临时排行' : periodName.value;
                return `${person.displayName} 综合得分 ${formatScore(person.totalScore)}，位列${prefix}第一。`;
            });
            const riskInsight = computed(() => {
                const missed = currentMetrics.value.filter((item) => item.satisfactionRate < rules.targets.satisfaction);
                const insufficient = currentMetrics.value.filter((item) => !item.isQualified).length;
                if (missed.length) return `${missed.length} 人满意率低于 90%，需要优先复盘差评。`;
                return insufficient ? `${insufficient} 人参与天数不足，仅在明细展示，不参与正式冠军评选。` : '当前参与人员满意率全部达标。';
            });
            const movementInsight = computed(() => {
                const mover = rankedByTotal.value.filter((item) => item.previousRank && item.previousRank > item.rankPosition)
                    .sort((a, b) => (b.previousRank - b.rankPosition) - (a.previousRank - a.rankPosition))[0];
                return mover ? `${mover.displayName} 较上次参与提升 ${mover.previousRank - mover.rankPosition} 名。` : '暂无明显上升人员或缺少上一参与日数据。';
            });

            const renderTrendChart = () => {
                if (!trendChartEl.value || !window.echarts || view.value !== 'dashboard') return;
                if (!trendChartEl.value.clientWidth || !trendChartEl.value.clientHeight) return;
                if (trendChart && trendChart.getDom() !== trendChartEl.value) {
                    trendChart.dispose();
                    trendChart = null;
                }
                if (!trendChart) trendChart = echarts.getInstanceByDom(trendChartEl.value) || echarts.init(trendChartEl.value);
                const chartDates = dashboardPeriod.value === 'yesterday'
                    ? [...periodScope.value.previousDates.slice(-1), ...periodScope.value.currentDates]
                    : periodScope.value.currentDates;
                const history = chartDates.map((date) => ({
                    key: date,
                    ...core.aggregateTeamMetrics(dashboardMetrics.value, [date])
                }));
                const focusDate = periodScope.value.currentDates.at(-1);
                const emphasizeLatest = (values, color) => values.map((value, index) => index === values.length - 1 && history[index]?.key === focusDate
                    ? { value, symbolSize: 10, itemStyle: { color, borderColor: '#ffffff', borderWidth: 2 } }
                    : value
                );
                const satisfactionData = history.map((item) => item.satisfactionRate == null ? null : +(item.satisfactionRate * 100).toFixed(2));
                const conversionData = history.map((item) => item.conversionRate == null ? null : +(item.conversionRate * 100).toFixed(2));
                const responseData = history.map((item) => item.avgResponseSeconds == null ? null : +item.avgResponseSeconds.toFixed(2));
                const isSingleDay = dashboardPeriod.value === 'yesterday' || periodScope.value.currentDates.length === 1;
                const current = history.at(-1) || {};
                const previous = history.length > 1 ? history.at(-2) : null;
                trendChart.setOption({
                    animationDuration: 250,
                    backgroundColor: 'transparent',
                    color: ['#38bdf8', '#18bd8b', '#f6a918'],
                    tooltip: { trigger: 'axis', backgroundColor: '#13223a', borderColor: '#2d4565', textStyle: { color: '#eaf4ff', fontSize: 11 } },
                    legend: { top: 2, right: 0, textStyle: { color: '#7e93ad', fontSize: 9 }, data: isSingleDay ? ['当前日期', '上一有效业务日'] : ['满意率', '转化率', '工作时间均响'] },
                    grid: { left: 34, right: 45, top: 44, bottom: 28 },
                    xAxis: { type: 'category', data: isSingleDay ? ['满意率', '均响(秒)', '转化率', '综合得分'] : history.map((item) => item.key.slice(5)), boundaryGap: !isSingleDay ? false : true, axisLine: { lineStyle: { color: '#2a3c57' } }, axisLabel: { color: '#6d829c', fontSize: 9 } },
                    yAxis: [
                        { type: 'value', min: 0, max: 100, axisLabel: { color: '#6d829c', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(134,158,187,.12)' } } },
                        { type: 'value', axisLabel: { color: '#6d829c', fontSize: 9, formatter: '{value}s' }, splitLine: { show: false } }
                    ],
                    series: isSingleDay ? [
                        { name: '当前日期', type: 'bar', barMaxWidth: 34, data: [current.satisfactionRate == null ? null : current.satisfactionRate * 100, current.avgResponseSeconds, current.conversionRate == null ? null : current.conversionRate * 100, current.avgTotalScore], label: { show: true, color: '#dcecff', fontSize: 9, position: 'top' } },
                        { name: '上一有效业务日', type: 'bar', barMaxWidth: 34, data: previous ? [previous.satisfactionRate == null ? null : previous.satisfactionRate * 100, previous.avgResponseSeconds, previous.conversionRate == null ? null : previous.conversionRate * 100, previous.avgTotalScore] : [], itemStyle: { opacity: .38 }, label: { show: !!previous, color: '#8ca3c0', fontSize: 8, position: 'top' } }
                    ] : [
                        { name: '满意率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: emphasizeLatest(satisfactionData, '#38bdf8'), lineStyle: { width: 3 }, areaStyle: { opacity: .05 }, markLine: dashboardPeriod.value === 'yesterday' && focusDate ? { silent: true, symbol: 'none', label: { formatter: '昨日', color: '#dcecff', fontSize: 9 }, lineStyle: { color: 'rgba(255,255,255,.28)', type: 'dashed' }, data: [{ xAxis: focusDate.slice(5) }] } : undefined },
                        { name: '转化率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: emphasizeLatest(conversionData, '#18bd8b'), lineStyle: { width: 2 } },
                        { name: '工作时间均响', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'diamond', symbolSize: 6, data: emphasizeLatest(responseData, '#f6a918'), lineStyle: { width: 2, type: 'dashed' } }
                    ]
                }, true);
                trendChart.resize();
            };
            const scheduleTrendChart = () => {
                cancelAnimationFrame(trendRenderFrame);
                nextTick(() => {
                    trendRenderFrame = requestAnimationFrame(() => {
                        renderTrendChart();
                        trendRenderFrame = requestAnimationFrame(renderTrendChart);
                    });
                });
            };

            const detailHistory = computed(() => detailAgent.value
                ? dashboardMetrics.value.filter((item) => item.agent_id === detailAgent.value.agentId).sort((a, b) => a.business_date.localeCompare(b.business_date))
                : []);
            const detailScope = computed(() => core.resolvePeriodScope(availableDates.value, detailPeriod.value));
            const detailPreviousDates = computed(() => {
                if (detailPeriod.value !== 'yesterday') return detailScope.value.previousDates;
                const currentDate = detailScope.value.currentDates[0];
                const previousParticipationDate = core.uniqueBusinessDates(detailHistory.value.map((item) => item.business_date))
                    .filter((date) => date < currentDate)
                    .at(-1);
                return previousParticipationDate ? [previousParticipationDate] : [];
            });
            const detailComparisonComplete = computed(() => detailPeriod.value === 'yesterday'
                ? detailPreviousDates.value.length === 1
                : detailScope.value.comparisonComplete
            );
            const detailRankingSet = computed(() => core.buildPeriodRanking(
                dashboardMetrics.value,
                detailScope.value.currentDates,
                detailScope.value.minimumParticipationDays,
                detailScope.value.provisional
            ));
            const detailMetric = computed(() => {
                if (!detailAgent.value) return null;
                const metric = detailRankingSet.value.allRows.find((item) => item.agentId === detailAgent.value.agentId);
                if (!metric) return null;
                if (detailPeriod.value !== 'yesterday') return metric;
                const date = detailScope.value.currentDates[0];
                const official = rankingLookup.value.get(`${date}:${metric.agentId}`);
                return { ...metric, rankPosition: official?.rank_position || metric.rankPosition };
            });
            const detailPreviousMetric = computed(() => detailAgent.value
                ? core.aggregateAgentMetrics(dashboardMetrics.value, detailPreviousDates.value)
                    .find((item) => item.agentId === detailAgent.value.agentId) || null
                : null
            );
            const detailPeriodName = computed(() => ({ yesterday: '昨日', last7: '近 7 日', month: '本月' }[detailPeriod.value]));
            const detailTrendTitle = computed(() => detailPeriod.value === 'yesterday'
                ? '近期指标趋势 · 昨日重点'
                : `${detailPeriodName.value}每日趋势`
            );
            const detailRangeText = computed(() => {
                const dates = detailScope.value.currentDates;
                if (!dates.length) return '暂无已确认数据';
                if (detailPeriod.value === 'yesterday') return `业务日期 ${dates[0]}`;
                if (detailPeriod.value === 'month') return `${dates.at(-1).slice(0, 7)} · ${dates.length} 个业务日`;
                return `${dates[0]} 至 ${dates.at(-1)} · ${dates.length} 个有效业务日`;
            });
            const detailRankText = computed(() => {
                if (!detailMetric.value) return '未参与';
                if (detailScope.value.provisional) return `月度样本积累中 · 临时第 ${detailMetric.value.rankPosition} 名`;
                if (!detailMetric.value.isQualified) return `样本不足 · 临时第 ${detailMetric.value.rankPosition} 名`;
                return `第 ${detailMetric.value.formalRankPosition || detailMetric.value.rankPosition} / ${detailRankingSet.value.allRows.length} 名`;
            });
            const detailComparison = (metric) => {
                if (!detailComparisonComplete.value || !detailMetric.value || !detailPreviousMetric.value) {
                    return { text: '暂无完整对比', state: 'neutral' };
                }
                const definitions = {
                    satisfaction: ['satisfactionRate', 100, ' 个百分点', false],
                    response: ['avgResponseSeconds', 1, ' 秒', true],
                    conversion: ['conversionRate', 100, ' 个百分点', false],
                    score: ['totalScore', 1, ' 分', false]
                };
                const [field, multiplier, unit, lowerIsBetter] = definitions[metric];
                const current = detailMetric.value[field];
                const previous = detailPreviousMetric.value[field];
                if (current == null || previous == null) return { text: '暂无完整对比', state: 'neutral' };
                const delta = (Number(current) - Number(previous)) * multiplier;
                const state = Math.abs(delta) < 0.0001 ? 'neutral' : ((delta < 0) === lowerIsBetter ? 'positive' : 'negative');
                const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
                return { text: `${arrow} ${Math.abs(delta).toFixed(1)}${unit}`, state };
            };
            const detailTrendRows = computed(() => {
                if (!detailAgent.value) return [];
                const currentDate = detailScope.value.currentDates.at(-1);
                const dates = detailPeriod.value === 'yesterday'
                    ? core.uniqueBusinessDates(detailHistory.value.map((item) => item.business_date))
                        .filter((date) => !currentDate || date <= currentDate)
                        .slice(-7)
                    : detailScope.value.currentDates;
                const dateSet = new Set(dates);
                return detailHistory.value.filter((item) => dateSet.has(item.business_date));
            });
            const detailHonors = computed(() => {
                if (!detailAgent.value) return [];
                const honor = honorByAgent.value.get(detailAgent.value.agentId);
                if (!honor) return [];
                const records = honor.firstRows.slice(0, 20).map((row) => ({
                    key: `first-${row.business_date}`,
                    name: '当日综合第一名',
                    date: row.business_date
                }));
                if (honor.bestFirstStreak >= 2) {
                    records.unshift({
                        key: 'best-first-streak',
                        name: `最佳连续 ${honor.bestFirstStreak} 个有效业务日第一`,
                        date: '历史最佳'
                    });
                }
                return records;
            });
            const renderDetailChart = () => {
                if (!detailChartEl.value || !detailMetric.value || !window.echarts) return;
                if (!detailChartEl.value.clientWidth || !detailChartEl.value.clientHeight) return;
                if (detailChart && detailChart.getDom() !== detailChartEl.value) {
                    detailChart.dispose();
                    detailChart = null;
                }
                if (!detailChart) detailChart = echarts.getInstanceByDom(detailChartEl.value) || echarts.init(detailChartEl.value);
                const rows = detailTrendRows.value;
                const focusDate = detailScope.value.currentDates.at(-1);
                const emphasizeLatest = (values, color) => values.map((value, index) => rows[index]?.business_date === focusDate
                    ? { value, symbolSize: 9, itemStyle: { color, borderColor: '#ffffff', borderWidth: 2 } }
                    : value
                );
                detailChart.setOption({
                    animationDuration: 250,
                    color: ['#2f7df6', '#18bd8b', '#f6a918'],
                    tooltip: { trigger: 'axis' },
                    legend: { top: 0, right: 0, textStyle: { color: '#73869a', fontSize: 9 } },
                    grid: { left: 36, right: 43, top: 43, bottom: 28 },
                    xAxis: { type: 'category', boundaryGap: false, data: rows.map((item) => item.business_date.slice(5)), axisLabel: { color: '#7c8da0', fontSize: 9 } },
                    yAxis: [{ type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', fontSize: 9 }, splitLine: { lineStyle: { color: '#e8eef4' } } }, { type: 'value', axisLabel: { formatter: '{value}s', fontSize: 9 }, splitLine: { show: false } }],
                    series: [
                        { name: '满意率', type: 'line', smooth: true, data: emphasizeLatest(rows.map((item) => item.satisfaction_rate == null ? null : +(Number(item.satisfaction_rate) * 100).toFixed(2)), '#2f7df6'), markLine: detailPeriod.value === 'yesterday' && focusDate ? { silent: true, symbol: 'none', label: { formatter: '昨日', color: '#46627e', fontSize: 9 }, lineStyle: { color: '#9db0c3', type: 'dashed' }, data: [{ xAxis: focusDate.slice(5) }] } : undefined },
                        { name: '转化率', type: 'line', smooth: true, data: emphasizeLatest(rows.map((item) => item.conversion_rate == null ? null : +(Number(item.conversion_rate) * 100).toFixed(2)), '#18bd8b') },
                        { name: '均响', type: 'line', smooth: true, yAxisIndex: 1, data: emphasizeLatest(rows.map((item) => item.avg_response_seconds == null ? null : Number(item.avg_response_seconds)), '#f6a918') }
                    ]
                }, true);
                detailChart.resize();
            };
            const scheduleDetailChart = () => {
                cancelAnimationFrame(detailRenderFrame);
                nextTick(() => {
                    detailRenderFrame = requestAnimationFrame(() => {
                        renderDetailChart();
                        detailRenderFrame = requestAnimationFrame(renderDetailChart);
                    });
                });
            };
            const openAgent = (person) => {
                detailAgent.value = {
                    agentId: person.agentId,
                    sourceAccount: person.sourceAccount,
                    displayName: person.displayName
                };
                detailPeriod.value = dashboardPeriod.value;
                scheduleDetailChart();
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
                    dashboardPeriod.value = 'yesterday';
                    await loadDashboard();
                    resetImport();
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

            watch(dashboardPeriod, scheduleTrendChart, { flush: 'post' });
            watch(dashboardMetrics, scheduleTrendChart, { flush: 'post' });
            watch(detailPeriod, scheduleDetailChart, { flush: 'post' });
            watch(detailTrendRows, scheduleDetailChart, { flush: 'post' });
            watch(view, (next) => { if (next === 'dashboard') scheduleTrendChart(); }, { flush: 'post' });

            const handleHashChange = () => {
                view.value = location.hash === '#import' ? 'import' : 'dashboard';
                if (view.value === 'dashboard') scheduleTrendChart();
            };

            onMounted(async () => {
                window.addEventListener('resize', handleResize);
                window.addEventListener('hashchange', handleHashChange);
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
                window.removeEventListener('hashchange', handleHashChange);
                authSubscription?.unsubscribe();
                cancelAnimationFrame(trendRenderFrame);
                cancelAnimationFrame(detailRenderFrame);
                trendChart?.dispose();
                detailChart?.dispose();
            });

            return {
                today, rules, view, steps, importStep, fileInfo, parseError, isParsing, isDragging,
                parsedAgents, selectedAccounts, agentSearch, businessDate, isSaving,
                session, showAuth, authMode, authLoading, authForm, duplicateBatch, toasts,
                dashboardLoading, availableDates, dashboardPeriod, rankingMetric, importHistoryRows, customStart, customEnd, noticeItems,
                periodOptions, rankingOptions, trendChartEl, detailChartEl, detailAgent, detailHistory,
                detailPeriod, detailScope, detailMetric, detailPreviousMetric, detailPeriodName,
                detailRangeText, detailRankText, detailComparison, detailTrendRows, detailTrendTitle, detailHonors,
                filteredAgents, previewMetrics, previewRanking, previewTeam, validationRows,
                hasBlockingValidation, canContinue, currentMetrics, currentTeam, rankedByTotal, rankingRows,
                periodScope, periodName, periodRangeText, dashboardStatusText, rankingTitle, trendTitle,
                currentChampion, eligibleRows, kpiComparison, formatChineseDate, attainment, salesRows, salesSummary,
                topInsight, riskInsight, movementInsight,
                formatBytes, formatPercent, percentValue, formatSeconds, formatScore, formatDateTime,
                previewPercent, previewConversion, isSelected, isAgentSelectable, toggleAgent, selectFiltered, clearFiltered,
                invertFiltered, handleFileInput, handleDrop, nextStep, previousStep, openImport, openDashboard,
                loadDashboard, rankingValue, rankingPositionText, rankChangeText, rankChangeClass, targetClass, honorLabel, historicalFirstCount, openAgent, closeAgent,
                submitAuth, signOut, requestSave, saveBatch
            };
        }
    });

    app.component('animated-number', AnimatedNumber);
    app.mount('#app');
})();
