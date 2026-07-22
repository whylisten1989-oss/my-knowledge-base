(function startCustomerBI() {
    const {
        createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick
    } = Vue;
    const core = window.CustomerBICore;
    const db = window.customerBISupabase;
    const ACCOUNT_NAME_OVERRIDES = {
        '123456789@qq.com': '岱旋内测账号'
    };

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

    const DateRangePicker = {
        props: {
            start: { type: String, default: '' },
            end: { type: String, default: '' },
            availableDates: { type: Array, default: () => [] },
            active: { type: Boolean, default: false }
        },
        emits: ['apply', 'clear'],
        setup(props, { emit }) {
            const todayValue = new Date().toISOString().slice(0, 10);
            const open = ref(false);
            const visibleMonth = ref(todayValue.slice(0, 7));
            const draftStart = ref('');
            const draftEnd = ref('');
            const hoverDate = ref('');
            const formatTrigger = (start, end) => {
                if (!start) return '自定义';
                const actualEnd = end || start;
                if (start === actualEnd) return start.slice(5).replace('-', '.');
                return start.slice(0, 4) === actualEnd.slice(0, 4)
                    ? `${start.slice(5).replace('-', '.')} - ${actualEnd.slice(5).replace('-', '.')}`
                    : `${start.replaceAll('-', '.')} - ${actualEnd.replaceAll('-', '.')}`;
            };
            const triggerLabel = computed(() => formatTrigger(props.start, props.end));
            const monthLabel = computed(() => { const [year, month] = visibleMonth.value.split('-').map(Number); return `${year} 年 ${month} 月`; });
            const calendarDays = computed(() => {
                const [year, month] = visibleMonth.value.split('-').map(Number);
                const leading = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
                const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
                const cells = Array.from({ length: leading }, (_, index) => ({ key: `blank-start-${index}`, blank: true }));
                for (let day = 1; day <= count; day += 1) {
                    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    cells.push({ key: date, date, day, enabled: props.availableDates.includes(date), today: date === todayValue });
                }
                while (cells.length % 7) cells.push({ key: `blank-end-${cells.length}`, blank: true });
                return cells;
            });
            const previewBounds = computed(() => {
                if (!draftStart.value) return null;
                let start = draftStart.value;
                let end = draftEnd.value || hoverDate.value || draftStart.value;
                if (end < start) [start, end] = [end, start];
                return { start, end, preview: !draftEnd.value && !!hoverDate.value };
            });
            const dateClasses = (cell) => {
                const bounds = previewBounds.value;
                if (!bounds || cell.blank) return { today: cell.today };
                return {
                    today: cell.today,
                    'range-start': cell.date === bounds.start,
                    'range-end': cell.date === bounds.end,
                    'range-middle': cell.date > bounds.start && cell.date < bounds.end,
                    preview: bounds.preview && cell.date >= bounds.start && cell.date <= bounds.end
                };
            };
            const rangeSummary = computed(() => {
                if (!draftStart.value) return '请选择开始日期';
                if (!draftEnd.value) return `${draftStart.value} · 请选择结束日期，或直接应用为单日`;
                return `${draftStart.value} 至 ${draftEnd.value}`;
            });
            const toggle = () => {
                if (open.value) { open.value = false; return; }
                draftStart.value = props.start;
                draftEnd.value = props.end && props.end !== props.start ? props.end : '';
                hoverDate.value = '';
                visibleMonth.value = (props.start || props.availableDates.at(-1) || todayValue).slice(0, 7);
                open.value = true;
            };
            const moveMonth = (offset) => { const [year, month] = visibleMonth.value.split('-').map(Number); visibleMonth.value = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7); };
            const choose = (cell) => {
                if (!cell?.enabled) return;
                if (!draftStart.value || draftEnd.value) { draftStart.value = cell.date; draftEnd.value = ''; }
                else if (cell.date < draftStart.value) { draftEnd.value = draftStart.value; draftStart.value = cell.date; }
                else draftEnd.value = cell.date;
                hoverDate.value = '';
            };
            const apply = () => { if (!draftStart.value) return; emit('apply', { start: draftStart.value, end: draftEnd.value || draftStart.value }); open.value = false; };
            const cancel = () => { open.value = false; hoverDate.value = ''; };
            const clear = () => { emit('clear'); draftStart.value = ''; draftEnd.value = ''; hoverDate.value = ''; open.value = false; };
            return { open, triggerLabel, monthLabel, calendarDays, draftStart, draftEnd, hoverDate, dateClasses, rangeSummary, toggle, moveMonth, choose, apply, cancel, clear };
        },
        template: `<div class="range-date-picker">
            <button :class="['range-date-trigger',{active}]" :title="triggerLabel" @click="toggle">{{ triggerLabel }} <span>▼</span></button>
            <div v-if="open" class="range-calendar">
                <header><button aria-label="上一个月" @click="moveMonth(-1)">‹</button><b>{{ monthLabel }}</b><button aria-label="下一个月" @click="moveMonth(1)">›</button></header>
                <div class="range-calendar-week"><span v-for="day in ['一','二','三','四','五','六','日']" :key="day">{{ day }}</span></div>
                <div class="range-calendar-grid"><template v-for="cell in calendarDays" :key="cell.key"><span v-if="cell.blank" class="blank"></span><button v-else :class="dateClasses(cell)" :disabled="!cell.enabled" @mouseenter="hoverDate=cell.enabled?cell.date:''" @mouseleave="hoverDate=''" @click="choose(cell)">{{ cell.day }}</button></template></div>
                <p class="range-summary">{{ rangeSummary }}</p>
                <footer><button @click="clear">清除</button><button @click="cancel">取消</button><button class="apply" :disabled="!draftStart" @click="apply">应用</button></footer>
            </div>
        </div>`
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
            const authForm = reactive({ email: '', username: '', password: '' });
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
            const salesChartEl = ref(null);
            const detailAgent = ref(null);
            const detailPeriod = ref('yesterday');
            const detailCustomStart = ref('');
            const detailCustomEnd = ref('');
            const openHonorGroup = ref('');
            const championIndex = ref(0);
            let trendChart = null;
            let detailChart = null;
            let salesChart = null;
            let authSubscription = null;
            let trendRenderFrame = 0;
            let detailRenderFrame = 0;
            let salesRenderFrame = 0;
            let championTimer = 0;

            const currentAccountName = computed(() => {
                const user = session.value?.user;
                if (!user) return '';
                const email = String(user.email || '');
                return ACCOUNT_NAME_OVERRIDES[email.toLowerCase()]
                    || String(user.user_metadata?.username || '').trim()
                    || email.split('@')[0]
                    || email
                    || '已登录';
            });

            const periodOptions = [
                { label: '昨日', value: 'yesterday' },
                { label: '近 7 日', value: 'last7' },
                { label: '本月', value: 'month' }, { label: '自定义', value: 'custom' }
            ];
            const dashboardPeriodOptions = periodOptions.filter((item) => item.value !== 'custom');
            const detailPeriodOptions = dashboardPeriodOptions;
            const noticeItems = ['数据仅统计已确认快照', '均响为工作时间平响时长（均值并不精准，仅供参考）', '本系统由事业一部岱旋 × Codex × Github × Supabase × Vercel 设计开发'];
            const noticeText = computed(() => noticeItems.join('　·　'));
            const noticeShouldScroll = computed(() => noticeText.value.length > 28);
            const selectPeriod = (mode) => { dashboardPeriod.value = mode; };
            const applyDashboardRange = ({ start, end }) => { customStart.value = start; customEnd.value = end; dashboardPeriod.value = 'custom'; };
            const clearDashboardRange = () => { customStart.value = ''; customEnd.value = ''; dashboardPeriod.value = 'yesterday'; };
            const applyDetailRange = ({ start, end }) => { detailCustomStart.value = start; detailCustomEnd.value = end; detailPeriod.value = 'custom'; };
            const clearDetailRange = () => { detailCustomStart.value = ''; detailCustomEnd.value = ''; detailPeriod.value = 'yesterday'; };
            const rankingOptions = [
                { label: '综合', value: 'total' }, { label: '满意率', value: 'satisfaction' },
                { label: '均响', value: 'response' }, { label: '转化率', value: 'conversion' }
            ];
            const honorMetricDefinitions = [
                { key: 'total', field: 'totalScore', title: '综合第一', lower: false },
                { key: 'satisfaction', field: 'satisfactionRate', title: '满意率第一', lower: false },
                { key: 'response', field: 'avgResponseSeconds', title: '响应第一', lower: true },
                { key: 'conversion', field: 'conversionRate', title: '转化第一', lower: false }
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
                scheduleSalesChart();
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
                const username = authForm.username.trim();
                if (authMode.value === 'register' && !/^[\p{L}\p{N}_]{2,20}$/u.test(username)) {
                    addToast('用户名需为 2～20 个中文、英文、数字或下划线', 'error');
                    return;
                }
                authLoading.value = true;
                try {
                    const result = authMode.value === 'login'
                        ? await db.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
                        : await db.auth.signUp({
                            email: authForm.email,
                            password: authForm.password,
                            options: { data: { username } }
                        });
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
            const historicalHonorAnnouncements = computed(() => {
                const candidates = [];
                const seen = new Set();
                const push = (text, weight) => { if (text && !seen.has(text)) { seen.add(text); candidates.push({ text, weight }); } };
                const latest = availableDates.value.at(-1);
                if (!latest) return candidates.map((item) => item.text);
                const scopes = [
                    { name: '本月累计', dates: availableDates.value.filter((date) => date.startsWith(latest.slice(0, 7))), weight: 30 },
                    { name: '近 7 日', dates: availableDates.value.slice(-7), weight: 20 }
                ];
                scopes.forEach((scope) => {
                    honorMetricDefinitions.forEach((definition) => {
                        const counts = new Map();
                        scope.dates.forEach((date) => {
                            const person = dailyWinnerMap.value.get(date)?.[definition.key];
                            if (!person) return;
                            const key = person.agentId || person.sourceAccount;
                            const entry = counts.get(key) || { person, count: 0 };
                            entry.count += 1;
                            counts.set(key, entry);
                        });
                        counts.forEach(({ person, count }) => {
                            if (count) push(`${person.displayName}${scope.name}获得 ${count} 次${definition.title}`, scope.weight + count * 5);
                        });
                    });
                });
                honorMetricDefinitions.forEach((definition) => {
                    const streaks = new Map();
                    let previousKey = '';
                    let currentCount = 0;
                    let currentPerson = null;
                    availableDates.value.forEach((date) => {
                        const person = dailyWinnerMap.value.get(date)?.[definition.key] || null;
                        const key = person ? person.agentId || person.sourceAccount : '';
                        if (key && key === previousKey) currentCount += 1;
                        else { previousKey = key; currentPerson = person; currentCount = key ? 1 : 0; }
                        if (currentPerson && currentCount >= 2) {
                            const best = streaks.get(key) || { person: currentPerson, count: 0 };
                            if (currentCount > best.count) streaks.set(key, { person: currentPerson, count: currentCount });
                        }
                    });
                    streaks.forEach(({ person, count }) => push(`${person.displayName}连续 ${count} 个有效业务日获得${definition.title}`, 40 + count * 6));
                });
                return candidates.sort((a, b) => b.weight - a.weight).slice(0, 8).map((item) => item.text);
            });
            const championAnnouncements = computed(() => {
                const winners = { total: null, satisfaction: null, response: null, conversion: null };
                rankedByTotal.value.forEach((row) => {
                    if (!row.isQualified && !periodScope.value.provisional) return;
                    honorMetricDefinitions.forEach((definition) => {
                        if (row[definition.field] == null) return;
                        const current = winners[definition.key];
                        if (!current || (definition.lower ? row[definition.field] < current[definition.field] : row[definition.field] > current[definition.field])) winners[definition.key] = row;
                    });
                });
                const labels = { total: '综合第一', satisfaction: '满意之星', response: '响应先锋', conversion: '转化高手' };
                const current = honorMetricDefinitions.filter((definition) => winners[definition.key]).map((definition) => `${periodName.value}${labels[definition.key]} · ${winners[definition.key].displayName}`);
                return [...new Set([...current, ...historicalHonorAnnouncements.value])].slice(0, 12);
            });
            const championAnnouncement = computed(() => championAnnouncements.value[championIndex.value % Math.max(1, championAnnouncements.value.length)] || '');
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
            const salesRows = computed(() => { const multi=periodScope.value.currentDates.length>1; return rankedByTotal.value.filter(item=>item.refundedSalesDays>0).map(item=>({...item,displaySales:multi?item.refundedSalesTotal:item.avgRefundedSales})).sort((a,b)=>b.displaySales-a.displaySales); });
            const salesSummary = computed(() => ({ total: salesRows.value.reduce((sum, item) => sum + item.refundedSalesTotal, 0), days: salesRows.value.reduce((sum, item) => sum + item.refundedSalesDays, 0) }));
            const formatCurrency = (value) => `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
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
            const allDailyRankings = computed(() => { const map=new Map(); availableDates.value.forEach(date=>map.set(date,core.buildPeriodRanking(dashboardMetrics.value,[date],1,false).allRows.filter(x=>x.isQualified))); return map; });
            const dailyWinnerMap = computed(() => {
                const result = new Map();
                allDailyRankings.value.forEach((rows, date) => {
                    const winners = {};
                    honorMetricDefinitions.forEach((definition) => {
                        let winner = null;
                        rows.forEach((row) => {
                            if (row[definition.field] == null) return;
                            if (!winner || (definition.lower ? row[definition.field] < winner[definition.field] : row[definition.field] > winner[definition.field])) winner = row;
                        });
                        winners[definition.key] = winner;
                    });
                    result.set(date, winners);
                });
                return result;
            });
            const championCountMap = computed(() => { const counts=new Map(); periodScope.value.currentDates.forEach(date=>{const winner=dailyWinnerMap.value.get(date)?.[rankingMetric.value];if(winner){const key=winner.agentId||winner.sourceAccount;counts.set(key,(counts.get(key)||0)+1);}}); return counts; });
            const championStyleMap = computed(() => { const values=[...new Set(championCountMap.value.values())].sort((a,b)=>a-b); const result=new Map(); championCountMap.value.forEach((count,key)=>{const level=values.length<2?4:Math.round(values.indexOf(count)*4/(values.length-1));result.set(key,{rarity:['common','uncommon','rare','epic','legendary'][level],style:{fontSize:`${9.5+level*.35}px`,fontWeight:String(600+level*50)}});});return result; });
            const honorLabel = (person) => {
                const count = historicalFirstCount(person);
                if (count) return `×${count}`;
                const honor = honorByAgent.value.get(person.agentId); if (!honor) return '';
                if (honor.currentFirstStreak >= 2) return `连续 ${honor.currentFirstStreak} 个有效业务日第一`;
                if (honor.firstRows.length) return `历史第一 ${honor.firstRows.length} 次`;
                return '';
            };
            const historicalFirstCount = (person) => {
                const key = person.agentId || person.sourceAccount;
                return championCountMap.value.get(key) || 0;
            };
            const championLabel = computed(() => ({total:'综合第一',satisfaction:'满意率第一',response:'响应第一',conversion:'转化第一'}[rankingMetric.value]));
            const honorRarity = (person) => championStyleMap.value.get(person.agentId||person.sourceAccount)?.rarity || 'common';
            const honorStyle = (person) => championStyleMap.value.get(person.agentId||person.sourceAccount)?.style || null;
            const singleDayMode = computed(() => periodScope.value.currentDates.length === 1);
            const singleDayKpis = computed(() => [{key:'satisfaction',name:'满意率',value:currentTeam.value.satisfactionRate,display:formatPercent(currentTeam.value.satisfactionRate),target:.9,passed:currentTeam.value.satisfactionRate>=.9,progress:Math.min(100,(currentTeam.value.satisfactionRate||0)/.9*82),gap:currentTeam.value.satisfactionRate==null?'暂无数据':currentTeam.value.satisfactionRate>=.9?`高于目标 ${((currentTeam.value.satisfactionRate-.9)*100).toFixed(1)}%`:`距目标 ${((.9-currentTeam.value.satisfactionRate)*100).toFixed(1)}%`},{key:'response',name:'工作时间均响',value:currentTeam.value.avgResponseSeconds,display:formatSeconds(currentTeam.value.avgResponseSeconds),target:15,passed:currentTeam.value.avgResponseSeconds!=null&&currentTeam.value.avgResponseSeconds<=15,progress:Math.min(100,15/Math.max(8,currentTeam.value.avgResponseSeconds||30)*82),gap:currentTeam.value.avgResponseSeconds==null?'暂无数据':currentTeam.value.avgResponseSeconds<=15?`优于目标 ${(15-currentTeam.value.avgResponseSeconds).toFixed(1)} 秒`:`超出目标 ${(currentTeam.value.avgResponseSeconds-15).toFixed(1)} 秒`},{key:'conversion',name:'转化率',value:currentTeam.value.conversionRate,display:formatPercent(currentTeam.value.conversionRate),target:.3,passed:currentTeam.value.conversionRate>=.3,progress:Math.min(100,(currentTeam.value.conversionRate||0)/.3*82),gap:currentTeam.value.conversionRate==null?'暂无数据':currentTeam.value.conversionRate>=.3?`高于目标 ${((currentTeam.value.conversionRate-.3)*100).toFixed(1)}%`:`距目标 ${((.3-currentTeam.value.conversionRate)*100).toFixed(1)}%`},{key:'score',name:'综合得分',value:currentTeam.value.avgTotalScore,display:`${formatScore(currentTeam.value.avgTotalScore)} 分`,target:null,passed:null,progress:Math.min(100,(currentTeam.value.avgTotalScore||0)/110*100),gap:'按现有三项 KPI 权重计算'}]);
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
                return insufficient ? `${insufficient} 人参与天数不足，仅在明细展示，不参与正式第一评选。` : '当前参与人员满意率全部达标。';
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
                const metricText = (index, value) => value == null ? '—' : index === 0 || index === 2 ? `${Number(value).toFixed(1)}%` : index === 1 ? `${Number(value).toFixed(1)} 秒` : `${Number(value).toFixed(1)} 分`;
                trendChart.clear();
                trendChart.setOption({
                    animationDuration: 250,
                    backgroundColor: 'transparent',
                    color: ['#38bdf8', '#18bd8b', '#f6a918'],
                    tooltip: { trigger: 'axis', backgroundColor: '#13223a', borderColor: '#2d4565', textStyle: { color: '#eaf4ff', fontSize: 11 }, formatter: (items) => isSingleDay ? `${items[0]?.axisValue}<br>${items.map(x => `${x.marker}${x.seriesName}：${metricText(x.dataIndex, x.value)}`).join('<br>')}` : `${items[0]?.axisValue}<br>${items.map(x => `${x.marker}${x.seriesName}：${x.seriesName === '工作时间均响' ? `${Number(x.value).toFixed(1)} 秒` : x.seriesName === '综合得分' ? `${Number(x.value).toFixed(1)} 分` : `${Number(x.value).toFixed(1)}%`}`).join('<br>')}` },
                    legend: { top: 4, right: 8, itemWidth: 14, itemHeight: 6, itemGap: 12, icon: 'roundRect', textStyle: { color: '#7e93ad', fontSize: 9 }, data: isSingleDay ? [] : ['满意率', '转化率', '工作时间均响'] },
                    grid: { left: 12, right: 18, top: 58, bottom: 18, containLabel: true },
                    xAxis: { type: 'category', data: isSingleDay ? ['满意率', '均响(秒)', '转化率', '综合得分'] : history.map((item) => item.key.slice(5)), boundaryGap: !isSingleDay ? false : true, axisLine: { lineStyle: { color: '#2a3c57' } }, axisLabel: { color: '#6d829c', fontSize: 9 } },
                    yAxis: [
                        { type: 'value', min: 0, max: 100, axisLabel: { color: '#6d829c', fontSize: 9, formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(134,158,187,.12)' } } },
                        { type: 'value', axisLabel: { color: '#6d829c', fontSize: 9, formatter: '{value}s' }, splitLine: { show: false } }
                    ],
                    series: isSingleDay ? [
                        { name: '当前日期', type: 'bar', barWidth: 18, barGap: '35%', data: [current.satisfactionRate == null ? null : current.satisfactionRate * 100, current.avgResponseSeconds, current.conversionRate == null ? null : current.conversionRate * 100, current.avgTotalScore], label: { show: true, color: '#dcecff', fontSize: 9, position: 'top', formatter: x => metricText(x.dataIndex, x.value) } },
                        { name: '上一有效业务日', type: 'bar', barWidth: 18, data: previous ? [previous.satisfactionRate == null ? null : previous.satisfactionRate * 100, previous.avgResponseSeconds, previous.conversionRate == null ? null : previous.conversionRate * 100, previous.avgTotalScore] : [], itemStyle: { opacity: .38 }, label: { show: !!previous, color: '#8ca3c0', fontSize: 8, position: 'top', formatter: x => metricText(x.dataIndex, x.value) } }
                    ] : [
                        { name: '满意率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: emphasizeLatest(satisfactionData, '#38bdf8'), lineStyle: { width: 3 }, areaStyle: { opacity: .05 }, markLine: dashboardPeriod.value === 'yesterday' && focusDate ? { silent: true, symbol: 'none', label: { formatter: '昨日', color: '#dcecff', fontSize: 9 }, lineStyle: { color: 'rgba(255,255,255,.28)', type: 'dashed' }, data: [{ xAxis: focusDate.slice(5) }] } : undefined },
                        { name: '转化率', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: emphasizeLatest(conversionData, '#18bd8b'), lineStyle: { width: 2 } },
                        { name: '工作时间均响', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'diamond', symbolSize: 6, data: emphasizeLatest(responseData, '#f6a918'), lineStyle: { width: 2, type: 'dashed' } }
                    ]
                }, true);
            };
            const renderSalesChart = () => {
                if (!salesChartEl.value || !window.echarts || view.value !== 'dashboard') return;
                if (!salesChartEl.value.clientWidth || !salesChartEl.value.clientHeight) return;
                if (salesChart && salesChart.getDom() !== salesChartEl.value) { salesChart.dispose(); salesChart = null; }
                if (!salesChart) salesChart = echarts.getInstanceByDom(salesChartEl.value) || echarts.init(salesChartEl.value);
                const rows = salesRows.value.slice(0, 16); const multi = periodScope.value.currentDates.length > 1;
                salesChart.clear(); salesChart.setOption({ animationDuration: 220, grid:{left:12,right:70,top:4,bottom:4,containLabel:true}, tooltip:{trigger:'axis',axisPointer:{type:'shadow'},backgroundColor:'#13223a',borderColor:'#2d4565',textStyle:{color:'#eaf4ff',fontSize:10},formatter:(items)=>{const p=rows[items[0].dataIndex];return `${p.displayName}<br>${multi?'周期累计销售额':'当日销售额'}：${formatCurrency(p.displaySales)}${multi?`<br>日均销售额：${formatCurrency(p.avgRefundedSales)}<br>实际参与：${p.refundedSalesDays} 日`:''}`; }}, dataZoom:rows.length>8?[{type:'inside',yAxisIndex:0,startValue:0,endValue:7}]:[],xAxis:{type:'value',show:false,max:(range)=>range.max>0?range.max*1.16:1}, yAxis:{type:'category',inverse:true,data:rows.map(x=>x.displayName.length>7?`${x.displayName.slice(0,7)}…`:x.displayName),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#8ea1b8',fontSize:9}}, series:[{type:'bar',clip:false,data:rows.map((x,i)=>({value:x.displaySales,itemStyle:{color:{type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:i<3?'rgba(91,143,221,.72)':'rgba(47,125,246,.55)'},{offset:1,color:i<3?'rgba(92,190,192,.82)':'rgba(62,153,211,.75)'}]},borderRadius:[0,7,7,0]}})),barMaxWidth:14,emphasis:{itemStyle:{opacity:1}},label:{show:true,position:'right',distance:7,color:'#dcecff',fontSize:9,formatter:({value})=>formatCurrency(value)},labelLayout:{hideOverlap:false}}]}, true);
            };
            const scheduleTrendChart = () => {
                cancelAnimationFrame(trendRenderFrame);
                nextTick(() => {
                    trendRenderFrame = requestAnimationFrame(() => {
                        renderTrendChart();
                        trendRenderFrame = requestAnimationFrame(() => trendChart?.resize());
                    });
                });
            };
            const scheduleSalesChart = () => { cancelAnimationFrame(salesRenderFrame); nextTick(()=>{ salesRenderFrame=requestAnimationFrame(()=>{ renderSalesChart(); salesRenderFrame=requestAnimationFrame(()=>salesChart?.resize()); }); }); };

            const detailHistory = computed(() => detailAgent.value
                ? dashboardMetrics.value.filter((item) => item.agent_id === detailAgent.value.agentId || item.source_account === detailAgent.value.sourceAccount || item.bi_agents?.source_account === detailAgent.value.sourceAccount).sort((a, b) => a.business_date.localeCompare(b.business_date))
                : []);
            const detailScope = computed(() => {
                if (detailPeriod.value !== 'custom') return core.resolvePeriodScope(availableDates.value, detailPeriod.value);
                const dates = availableDates.value.filter((date) => date >= detailCustomStart.value && date <= detailCustomEnd.value);
                const previousDates = dates.length
                    ? availableDates.value.filter((date) => date < dates[0]).slice(-dates.length)
                    : [];
                return {
                    period: 'custom',
                    baseDate: dates.at(-1) || null,
                    currentDates: dates,
                    previousDates,
                    comparisonComplete: dates.length > 0 && previousDates.length === dates.length,
                    minimumParticipationDays: dates.length > 1 ? 2 : 1,
                    provisional: false
                };
            });
            const selectDetailPeriod = (period) => { detailPeriod.value = period; };
            const detailPreviousDates = computed(() => {
                if (detailScope.value.currentDates.length !== 1) return detailScope.value.previousDates;
                const currentDate = detailScope.value.currentDates[0];
                const previousParticipationDate = core.uniqueBusinessDates(detailHistory.value.map((item) => item.business_date))
                    .filter((date) => date < currentDate)
                    .at(-1);
                return previousParticipationDate ? [previousParticipationDate] : [];
            });
            const detailComparisonComplete = computed(() => detailScope.value.currentDates.length === 1
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
                const key = detailAgent.value.agentId || detailAgent.value.sourceAccount;
                const metric = detailRankingSet.value.allRows.find((item) => (item.agentId || item.sourceAccount) === key);
                if (!metric) return null;
                if (detailScope.value.currentDates.length !== 1) return metric;
                const date = detailScope.value.currentDates[0];
                const official = rankingLookup.value.get(`${date}:${metric.agentId}`);
                return { ...metric, rankPosition: official?.rank_position || metric.rankPosition };
            });
            const detailPreviousMetric = computed(() => detailAgent.value
                ? core.aggregateAgentMetrics(dashboardMetrics.value, detailPreviousDates.value)
                    .find((item) => (item.agentId || item.sourceAccount) === (detailAgent.value.agentId || detailAgent.value.sourceAccount)) || null
                : null
            );
            const detailPeriodName = computed(() => ({ yesterday: '昨日', last7: '近 7 日', month: '本月', custom: '自定义' }[detailPeriod.value]));
            const detailSingleDayMode = computed(() => detailScope.value.currentDates.length === 1 && (detailPeriod.value === 'yesterday' || detailPeriod.value === 'custom'));
            const detailTrendTitle = computed(() => detailSingleDayMode.value
                ? '单日指标达成'
                : `${detailPeriodName.value}每日趋势`
            );
            const detailRangeText = computed(() => {
                const dates = detailScope.value.currentDates;
                if (!dates.length) return '暂无已确认数据';
                if (detailSingleDayMode.value) return `业务日期 ${dates[0]}`;
                if (detailPeriod.value === 'month') return `${dates.at(-1).slice(0, 7)} · ${dates.length} 个业务日`;
                return `${dates[0]} 至 ${dates.at(-1)} · ${dates.length} 个有效业务日`;
            });
            const detailRankText = computed(() => {
                if (!detailMetric.value) return '未参与';
                if (detailScope.value.provisional) return `月度样本积累中 · 临时第 ${detailMetric.value.rankPosition} 名`;
                if (!detailMetric.value.isQualified) return `样本不足 · 临时第 ${detailMetric.value.rankPosition} 名`;
                return `第 ${detailMetric.value.formalRankPosition || detailMetric.value.rankPosition} / ${detailRankingSet.value.allRows.length} 名`;
            });
            const detailSalesDisplay = computed(() => detailMetric.value?.refundedSalesDays ? formatCurrency(detailMetric.value.refundedSalesTotal) : '—');
            const detailSingleDayKpis = computed(() => {
                const metric = detailMetric.value || {};
                return [
                    { key:'satisfaction', name:'满意率', display:formatPercent(metric.satisfactionRate), target:.9, passed:metric.satisfactionRate==null?null:metric.satisfactionRate>=.9, progress:Math.min(100,(metric.satisfactionRate||0)/.9*82), gap:metric.satisfactionRate==null?'暂无数据':metric.satisfactionRate>=.9?`高于目标 ${((metric.satisfactionRate-.9)*100).toFixed(1)}%`:`距目标 ${((.9-metric.satisfactionRate)*100).toFixed(1)}%` },
                    { key:'response', name:'工作时间均响', display:formatSeconds(metric.avgResponseSeconds), target:15, passed:metric.avgResponseSeconds==null?null:metric.avgResponseSeconds<=15, progress:Math.min(100,15/Math.max(8,metric.avgResponseSeconds||30)*82), gap:metric.avgResponseSeconds==null?'暂无数据':metric.avgResponseSeconds<=15?`优于目标 ${(15-metric.avgResponseSeconds).toFixed(1)} 秒`:`超出目标 ${(metric.avgResponseSeconds-15).toFixed(1)} 秒` },
                    { key:'conversion', name:'转化率', display:formatPercent(metric.conversionRate), target:.3, passed:metric.conversionRate==null?null:metric.conversionRate>=.3, progress:Math.min(100,(metric.conversionRate||0)/.3*82), gap:metric.conversionRate==null?'暂无数据':metric.conversionRate>=.3?`高于目标 ${((metric.conversionRate-.3)*100).toFixed(1)}%`:`距目标 ${((.3-metric.conversionRate)*100).toFixed(1)}%` },
                    { key:'score', name:'综合得分', display:`${formatScore(metric.totalScore)} 分`, target:null, passed:null, progress:Math.min(100,(metric.totalScore||0)/110*100), gap:'按现有三项 KPI 权重计算' }
                ];
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
                const dates = detailSingleDayMode.value
                    ? core.uniqueBusinessDates(detailHistory.value.map((item) => item.business_date))
                        .filter((date) => date === currentDate)
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
            const detailHonorGroups = computed(() => { if(!detailAgent.value)return []; const key=detailAgent.value.agentId||detailAgent.value.sourceAccount; const meta={total:['综合荣誉','综合第一','🥇'],satisfaction:['满意率荣誉','满意率第一','🏅'],response:['响应效率荣誉','响应第一','⚡'],conversion:['转化率荣誉','转化第一','📈']}; return honorMetricDefinitions.map((definition)=>{const [name,title,icon]=meta[definition.key];const dates=availableDates.value.filter(date=>{const winner=dailyWinnerMap.value.get(date)?.[definition.key];return winner&&(winner.agentId||winner.sourceAccount)===key;}).reverse();return {id:definition.key,name,title,icon,dates,count:dates.length};}); });
            const toggleHonorGroup = (group) => { if(!group.count)return; openHonorGroup.value=openHonorGroup.value===group.id?'':group.id; };
            const renderDetailChart = () => {
                if (detailSingleDayMode.value) { detailChart?.dispose(); detailChart = null; return; }
                if (!detailChartEl.value || !detailMetric.value || !window.echarts) return;
                if (!detailChartEl.value.clientWidth || !detailChartEl.value.clientHeight) return;
                if (detailChart && detailChart.getDom() !== detailChartEl.value) {
                    detailChart.dispose();
                    detailChart = null;
                }
                if (!detailChart) detailChart = echarts.getInstanceByDom(detailChartEl.value) || echarts.init(detailChartEl.value);
                const rows = detailTrendRows.value;
                const formatDetailTooltip = (items) => `${items[0]?.axisValue || ''}<br>${items.map((item) => `${item.marker}${item.seriesName}：${item.seriesName === '工作时间均响' ? `${Number(item.value).toFixed(1)} 秒` : `${Number(item.value).toFixed(1)}%`}`).join('<br>')}`;
                detailChart.clear();
                detailChart.setOption({
                    animationDuration: 250,
                    color: ['#2f7df6', '#18bd8b', '#f6a918'],
                    tooltip: { trigger: 'axis', backgroundColor:'#fff', borderColor:'#d8e2ed', textStyle:{color:'#38516a',fontSize:10}, formatter:formatDetailTooltip },
                    legend: { top: 2, right: 6, itemWidth:14, itemHeight:6, itemGap:12, icon:'roundRect', textStyle: { color: '#73869a', fontSize: 9 }, data:['满意率','转化率','工作时间均响'] },
                    grid: { left: 12, right: 18, top: 52, bottom: 14, containLabel:true },
                    xAxis: { type: 'category', boundaryGap: false, data: rows.map((item) => item.business_date.slice(5)), axisLine:{lineStyle:{color:'#d7e1eb'}}, axisTick:{show:false}, axisLabel: { color: '#7c8da0', fontSize: 9 } },
                    yAxis: [{ type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%', color:'#7c8da0', fontSize: 9 }, splitLine: { lineStyle: { color: '#e8eef4' } } }, { type: 'value', axisLabel: { formatter: '{value}s', color:'#7c8da0', fontSize: 9 }, splitLine: { show: false } }],
                    series: [
                        { name: '满意率', type: 'line', smooth: true, symbol:'circle', symbolSize:5, data: rows.map((item) => item.satisfaction_rate == null ? null : +(Number(item.satisfaction_rate) * 100).toFixed(1)), lineStyle:{width:2}, areaStyle:{opacity:.035} },
                        { name: '转化率', type: 'line', smooth: true, symbol:'circle', symbolSize:5, data: rows.map((item) => item.conversion_rate == null ? null : +(Number(item.conversion_rate) * 100).toFixed(1)), lineStyle:{width:2} },
                        { name: '工作时间均响', type: 'line', smooth: true, symbol:'diamond', symbolSize:6, yAxisIndex: 1, data: rows.map((item) => item.avg_response_seconds == null ? null : +Number(item.avg_response_seconds).toFixed(1)), lineStyle:{width:2,type:'dashed'} }
                    ]
                }, true);
            };
            const scheduleDetailChart = () => {
                cancelAnimationFrame(detailRenderFrame);
                nextTick(() => {
                    detailRenderFrame = requestAnimationFrame(() => {
                        renderDetailChart();
                        detailRenderFrame = requestAnimationFrame(() => detailChart?.resize());
                    });
                });
            };
            const openAgent = (person) => {
                detailAgent.value = {
                    agentId: person.agentId,
                    sourceAccount: person.sourceAccount,
                    displayName: person.displayName
                };
                if (!['yesterday','last7','month','custom'].includes(detailPeriod.value)) detailPeriod.value = 'yesterday';
                nextTick(()=>{ openHonorGroup.value=detailHonorGroups.value.find(x=>x.count)?.id||''; });
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
                trendChart?.resize(); salesChart?.resize();
                detailChart?.resize();
            };

            watch(periodScope, scheduleTrendChart, { flush: 'post' });
            watch(dashboardMetrics, scheduleTrendChart, { flush: 'post' });
            watch(salesRows, scheduleSalesChart, { flush: 'post' });
            watch(detailPeriod, scheduleDetailChart, { flush: 'post' });
            watch(detailTrendRows, scheduleDetailChart, { flush: 'post' });
            watch(view, (next) => { if (next === 'dashboard') { scheduleTrendChart(); scheduleSalesChart(); } }, { flush: 'post' });

            const handleHashChange = () => {
                view.value = location.hash === '#import' ? 'import' : 'dashboard';
                if (view.value === 'dashboard') { scheduleTrendChart(); scheduleSalesChart(); }
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
                if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) championTimer=window.setInterval(()=>{ if(championAnnouncements.value.length>1) championIndex.value=(championIndex.value+1)%championAnnouncements.value.length; },4200);
            });
            onBeforeUnmount(() => {
                window.removeEventListener('resize', handleResize);
                window.removeEventListener('hashchange', handleHashChange);
                authSubscription?.unsubscribe();
                cancelAnimationFrame(trendRenderFrame);
                cancelAnimationFrame(detailRenderFrame);
                cancelAnimationFrame(salesRenderFrame);
                trendChart?.dispose(); salesChart?.dispose();
                detailChart?.dispose();
                window.clearInterval(championTimer);
            });

            return {
                today, rules, view, steps, importStep, fileInfo, parseError, isParsing, isDragging,
                parsedAgents, selectedAccounts, agentSearch, businessDate, isSaving,
                session, currentAccountName, showAuth, authMode, authLoading, authForm, duplicateBatch, toasts,
                dashboardLoading, availableDates, dashboardPeriod, rankingMetric, importHistoryRows, customStart, customEnd, noticeItems, noticeText, noticeShouldScroll,
                dashboardPeriodOptions, detailPeriodOptions, rankingOptions, trendChartEl, salesChartEl, detailChartEl, detailAgent, detailHistory,
                detailPeriod, detailCustomStart, detailCustomEnd, detailScope, detailMetric, detailPreviousMetric, detailPeriodName,
                detailRangeText, detailRankText, detailComparison, detailTrendRows, detailTrendTitle, detailHonors, detailHonorGroups, openHonorGroup, detailSingleDayMode, detailSingleDayKpis, detailSalesDisplay,
                filteredAgents, previewMetrics, previewRanking, previewTeam, validationRows,
                hasBlockingValidation, canContinue, currentMetrics, currentTeam, rankedByTotal, rankingRows,
                periodScope, periodName, periodRangeText, dashboardStatusText, rankingTitle, trendTitle,
                currentChampion, eligibleRows, kpiComparison, formatChineseDate, attainment, salesRows, salesSummary, championAnnouncement, championLabel, singleDayMode, singleDayKpis,
                topInsight, riskInsight, movementInsight,
                formatBytes, formatPercent, percentValue, formatSeconds, formatScore, formatDateTime, formatCurrency,
                previewPercent, previewConversion, isSelected, isAgentSelectable, toggleAgent, selectFiltered, clearFiltered,
                invertFiltered, handleFileInput, handleDrop, nextStep, previousStep, openImport, openDashboard,
                loadDashboard, rankingValue, rankingPositionText, rankChangeText, rankChangeClass, targetClass, honorLabel, historicalFirstCount, honorRarity, honorStyle, openAgent, closeAgent, selectPeriod, applyDashboardRange, clearDashboardRange, applyDetailRange, clearDetailRange, toggleHonorGroup, selectDetailPeriod,
                submitAuth, signOut, requestSave, saveBatch
            };
        }
    });

    app.component('animated-number', AnimatedNumber);
    app.component('date-range-picker', DateRangePicker);
    app.mount('#app');
})();
