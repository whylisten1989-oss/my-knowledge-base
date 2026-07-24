(() => {
  'use strict';

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const clone = (value) => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));

  const VIEW_START_MINUTES = 8 * 60;
  const VIEW_END_MINUTES = 24 * 60;
  const SLOT_MINUTES = 30;
  const SLOT_WIDTH = 58;
  const PERSON_COLUMN_WIDTH = 250;

  let people = clone(window.WORKFORCE_MOCK.people || []);
  let shifts = clone(window.WORKFORCE_MOCK.shifts || []);
  let currentView = 'day';
  let dataSourceName = '模拟数据';
  const STORAGE_KEY = 'workforce-center:schedule:v1';

  const state = {
    date: window.WORKFORCE_MOCK.initialDate || isoDate(new Date()),
    group: 'all',
    person: 'all',
    shift: 'all',
    status: 'all',
    skill: 'all'
  };

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseIsoDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
  }

  function mondayOf(date) {
    const result = new Date(date);
    const day = result.getDay() || 7;
    result.setDate(result.getDate() - day + 1);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function timeToMinutes(value) {
    if (value === '24:00') return 1440;
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return Number.NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function intervalForShift(shift) {
    const start = timeToMinutes(shift.start);
    let end = timeToMinutes(shift.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end <= start && shift.end !== shift.start) end += 1440;
    return { start, end };
  }

  function mergeIntervals(intervals) {
    const sorted = intervals
      .filter(Boolean)
      .map((item) => ({ start: item.start, end: item.end }))
      .filter((item) => item.end > item.start)
      .sort((a, b) => a.start - b.start);

    const merged = [];
    sorted.forEach((interval) => {
      const last = merged.at(-1);
      if (!last || interval.start > last.end) {
        merged.push(interval);
      } else {
        last.end = Math.max(last.end, interval.end);
      }
    });
    return merged;
  }

  function subtractIntervals(baseIntervals, exclusionIntervals) {
    let result = mergeIntervals(baseIntervals);
    const exclusions = mergeIntervals(exclusionIntervals);

    exclusions.forEach((exclusion) => {
      const next = [];
      result.forEach((base) => {
        if (exclusion.end <= base.start || exclusion.start >= base.end) {
          next.push(base);
          return;
        }
        if (exclusion.start > base.start) {
          next.push({ start: base.start, end: exclusion.start });
        }
        if (exclusion.end < base.end) {
          next.push({ start: exclusion.end, end: base.end });
        }
      });
      result = next;
    });
    return result;
  }

  function shiftsForPerson(personId, date = state.date, respectVisualFilters = false) {
    return shifts.filter((shift) => {
      if (shift.personId !== personId || shift.date !== date) return false;
      if (!respectVisualFilters) return true;
      if (state.shift !== 'all' && shift.shiftName !== state.shift) return false;
      if (state.status !== 'all' && shift.status !== state.status) return false;
      return true;
    });
  }

  function effectiveWorkIntervals(personId, date = state.date) {
    const personRecords = shiftsForPerson(personId, date, false);
    const work = personRecords
      .filter((shift) => shift.status === '工作')
      .map(intervalForShift);
    const exclusions = personRecords
      .filter((shift) => shift.status !== '工作')
      .map(intervalForShift);
    return subtractIntervals(work, exclusions);
  }

  function effectiveWorkMinutes(personId, date = state.date) {
    return effectiveWorkIntervals(personId, date)
      .reduce((total, interval) => total + Math.max(0, interval.end - interval.start), 0);
  }

  function isWorkingAt(personId, date, minute) {
    return effectiveWorkIntervals(personId, date)
      .some((interval) => interval.start <= minute && interval.end > minute);
  }

  function currentStatusForPerson(personId, date = state.date) {
    const now = new Date();
    if (date !== isoDate(now)) return '计划排班';
    const minute = now.getHours() * 60 + now.getMinutes();
    const records = shiftsForPerson(personId, date, false);
    const activeNonWork = records.find((shift) => {
      if (shift.status === '工作') return false;
      const interval = intervalForShift(shift);
      return interval && interval.start <= minute && interval.end > minute;
    });
    if (activeNonWork) return activeNonWork.status;
    return isWorkingAt(personId, date, minute) ? '在岗中' : '未在岗';
  }

  function filteredPeople() {
    return people.filter((person) => {
      if (state.group !== 'all' && person.group !== state.group) return false;
      if (state.person !== 'all' && person.id !== state.person) return false;
      if (state.skill !== 'all' && person.skill !== state.skill) return false;

      const dateRecords = shiftsForPerson(person.id, state.date, false);
      if (!dateRecords.length) return false;
      if (state.shift !== 'all' && !dateRecords.some((shift) => shift.shiftName === state.shift)) return false;
      if (state.status !== 'all' && !dateRecords.some((shift) => shift.status === state.status)) return false;
      return true;
    });
  }

  function allScheduledPeople(date = state.date) {
    return people.filter((person) => shiftsForPerson(person.id, date, false).length > 0);
  }

  function demandAtHour(hour) {
    return Number(window.WORKFORCE_MOCK.demand?.[hour] || 0);
  }

  function coverageCountAt(date, minute) {
    return allScheduledPeople(date)
      .filter((person) => isWorkingAt(person.id, date, minute)).length;
  }

  function coverageGapAt(date, minute) {
    return coverageCountAt(date, minute) - demandAtHour(Math.min(23, Math.max(8, Math.floor(minute / 60))));
  }

  function formatDisplayDate(value) {
    const date = parseIsoDate(value);
    if (!date) return value;
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'short'
    }).format(date);
  }

  function updateClockHeader() {
    const now = new Date();
    $('#currentDate').textContent = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(now);
  }

  function updateDataSourceBadge() {
    const badge = $('#dataSourceBadge');
    badge.textContent = dataSourceName;
    badge.title = '上传数据仅保存在当前浏览器，不会写入 GitHub 或服务器';
  }

  function restoreLocalData() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.people) || !Array.isArray(saved.shifts) || !saved.shifts.length) return;
      people = saved.people;
      shifts = saved.shifts;
      dataSourceName = saved.dataSourceName || '本机已保存数据';
      const dates = [...new Set(shifts.map((shift) => shift.date).filter(Boolean))].sort();
      if (dates.length) state.date = dates.includes(state.date) ? state.date : dates[0];
    } catch (error) {
      console.warn('无法读取本机排班缓存，将使用模拟数据。', error);
    }
  }

  function persistLocalData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        dataSourceName,
        people,
        shifts
      }));
      return true;
    } catch (error) {
      console.warn('排班数据未能保存到本机缓存。', error);
      return false;
    }
  }

  function populateSelect(elementId, items) {
    const element = $(`#${elementId}`);
    element.querySelectorAll('option:not(:first-child)').forEach((option) => option.remove());
    items.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      element.append(option);
    });
  }

  function initFilters() {
    populateSelect('groupFilter', [...new Set(people.map((person) => person.group))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((value) => ({ value, label: value })));

    populateSelect('personFilter', people
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
      .map((person) => ({ value: person.id, label: person.name })));

    populateSelect('shiftFilter', [...new Set(shifts.map((shift) => shift.shiftName))]
      .filter(Boolean)
      .map((value) => ({ value, label: value })));

    populateSelect('statusFilter', [...new Set(shifts.map((shift) => shift.status))]
      .filter(Boolean)
      .map((value) => ({ value, label: value })));

    $('#groupFilter').value = optionExists('groupFilter', state.group) ? state.group : 'all';
    $('#personFilter').value = optionExists('personFilter', state.person) ? state.person : 'all';
    $('#shiftFilter').value = optionExists('shiftFilter', state.shift) ? state.shift : 'all';
    $('#statusFilter').value = optionExists('statusFilter', state.status) ? state.status : 'all';
    $('#skillFilter').value = state.skill;
  }

  function optionExists(elementId, value) {
    return [...$(`#${elementId}`).options].some((option) => option.value === value);
  }

  function renderSummary() {
    const displayedPeople = filteredPeople();
    const totalHours = displayedPeople.reduce((total, person) => total + effectiveWorkMinutes(person.id) / 60, 0);
    const totalOutput = displayedPeople.reduce((total, person) => {
      const hours = effectiveWorkMinutes(person.id) / 60;
      return total + hours * Number(person.hourlyOutput || 0);
    }, 0);

    const now = new Date();
    const isToday = state.date === isoDate(now);
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const activePeople = displayedPeople.filter((person) => isWorkingAt(person.id, state.date, nowMinute)).length;

    let coverageValue;
    let coverageHint;
    let coverageNegative = false;

    if (isToday && nowMinute >= VIEW_START_MINUTES && nowMinute <= VIEW_END_MINUTES) {
      const gap = coverageGapAt(state.date, nowMinute);
      coverageValue = gap >= 0 ? `充足 +${gap}` : `缺口 ${Math.abs(gap)} 人`;
      coverageHint = gap >= 0 ? '当前覆盖正常' : '当前需要关注';
      coverageNegative = gap < 0;
    } else {
      const hourlyGaps = [];
      for (let hour = 8; hour < 24; hour += 1) {
        hourlyGaps.push(coverageGapAt(state.date, hour * 60));
      }
      const minimumGap = Math.min(...hourlyGaps);
      coverageValue = minimumGap >= 0 ? `全天充足 +${minimumGap}` : `最大缺口 ${Math.abs(minimumGap)} 人`;
      coverageHint = minimumGap >= 0 ? '全日覆盖正常' : '存在不足时段';
      coverageNegative = minimumGap < 0;
    }

    const metrics = [
      ['排班人数', `${displayedPeople.length} 人`, '当前筛选'],
      [isToday ? '当前在岗' : '有效工作人数', `${isToday ? activePeople : displayedPeople.filter((person) => effectiveWorkMinutes(person.id) > 0).length} 人`, isToday ? '实时计算' : formatDisplayDate(state.date)],
      ['有效总工时', `${totalHours.toFixed(1)} h`, '已扣除休息等时段'],
      ['预计产出', `${Math.round(totalOutput).toLocaleString()} 通`, '按人员效率计算'],
      ['全团队覆盖', coverageValue, coverageHint]
    ];

    $('#summaryStrip').innerHTML = metrics.map((metric, index) => `
      <article class="metric" style="--metric-glow:${index === 4 && coverageNegative ? '#ff526a2e' : '#1686ff22'}">
        <small>${escapeHtml(metric[0])}</small>
        <strong>${escapeHtml(metric[1])}</strong>
        <em class="${index === 4 && coverageNegative ? 'negative' : ''}">${escapeHtml(metric[2])}</em>
      </article>
    `).join('');
  }

  function shortageRanges(date) {
    const result = [];
    let rangeStart = null;

    for (let hour = 8; hour < 24; hour += 1) {
      const shortage = coverageGapAt(date, hour * 60) < 0;
      if (shortage && rangeStart === null) rangeStart = hour;
      if (!shortage && rangeStart !== null) {
        result.push({ start: `${pad(rangeStart)}:00`, end: `${pad(hour)}:00` });
        rangeStart = null;
      }
    }

    if (rangeStart !== null) {
      result.push({ start: `${pad(rangeStart)}:00`, end: '24:00' });
    }
    return result;
  }

  function iconForStatus(status) {
    return ({ 工作: '◉', 休息: '☕', 培训: '▣', 会议: '◆', 请假: '○' })[status] || '•';
  }

  function clippedShiftLayout(shift) {
    const interval = intervalForShift(shift);
    if (!interval) return null;
    const clippedStart = Math.max(VIEW_START_MINUTES, interval.start);
    const clippedEnd = Math.min(VIEW_END_MINUTES, interval.end);
    if (clippedEnd <= clippedStart) return null;
    return {
      left: ((clippedStart - VIEW_START_MINUTES) / SLOT_MINUTES) * SLOT_WIDTH + 5,
      width: Math.max(45, ((clippedEnd - clippedStart) / SLOT_MINUTES) * SLOT_WIDTH - 10)
    };
  }

  function renderDay() {
    const displayedPeople = filteredPeople();
    const grid = $('#timelineGrid');
    const previousScrollLeft = $('#timelineScroll').scrollLeft;
    grid.style.setProperty('--people-count', Math.max(displayedPeople.length, 1));
    grid.innerHTML = '';

    grid.insertAdjacentHTML('beforeend', '<div class="corner">人员 / 小组 / 标签</div>');
    for (let index = 0; index < 32; index += 1) {
      const minute = VIEW_START_MINUTES + index * SLOT_MINUTES;
      grid.insertAdjacentHTML('beforeend', `
        <div class="time-label" style="grid-column:${index + 2}">
          ${index % 2 === 0 ? `${pad(Math.floor(minute / 60))}:00` : ''}
        </div>
      `);
    }

    if (!displayedPeople.length) {
      grid.insertAdjacentHTML('beforeend', `
        <div class="empty-timeline" style="grid-row:2">
          <strong>当前日期或筛选条件下暂无排班</strong>
          <span>可以切换日期、重置筛选，或上传新的排班 Excel。</span>
        </div>
      `);
    }

    displayedPeople.forEach((person, rowIndex) => {
      const personCell = document.createElement('button');
      personCell.type = 'button';
      personCell.className = 'person-cell';
      personCell.style.gridRow = String(rowIndex + 2);
      personCell.innerHTML = `
        <span class="avatar">${escapeHtml(person.avatar || person.name?.[0] || '?')}</span>
        <span class="person-info">
          <strong>${escapeHtml(person.name)}</strong>
          <span class="person-meta">
            <span>${escapeHtml(person.group)}</span>
            <span class="tag ${person.skill === '新人' ? 'new' : ''}">${escapeHtml(person.skill)}</span>
            <span>${escapeHtml(person.business)}</span>
          </span>
        </span>
      `;
      personCell.addEventListener('click', () => openDrawer(person));
      grid.append(personCell);

      const lane = document.createElement('div');
      lane.className = 'lane-cell';
      lane.style.gridRow = String(rowIndex + 2);
      lane.addEventListener('click', () => openDrawer(person));

      shiftsForPerson(person.id, state.date, true)
        .slice()
        .sort((a, b) => (a.status === '工作' ? -1 : 1) - (b.status === '工作' ? -1 : 1))
        .forEach((shift) => {
          const layout = clippedShiftLayout(shift);
          if (!layout) return;
          const block = document.createElement('button');
          block.type = 'button';
          block.className = `shift-block shift-${shift.status}`;
          block.dataset.shift = shift.shiftName;
          block.style.left = `${layout.left}px`;
          block.style.width = `${layout.width}px`;
          block.innerHTML = `
            <span>${iconForStatus(shift.status)}</span>
            <b>${escapeHtml(shift.shiftName)}</b>
            <span>${escapeHtml(shift.start)}–${escapeHtml(shift.end)}</span>
          `;
          block.addEventListener('click', (event) => {
            event.stopPropagation();
            openDrawer(person);
          });
          bindTooltip(block, `${person.name} · ${shift.shiftName}\n${shift.start}–${shift.end} · ${formatShiftDuration(shift)}`);
          lane.append(block);
        });
      grid.append(lane);
    });

    (window.WORKFORCE_MOCK.peakRanges || []).forEach((range) => {
      const start = timeToMinutes(range.start);
      const end = timeToMinutes(range.end);
      grid.insertAdjacentHTML('beforeend', `
        <div class="peak-band" style="left:${PERSON_COLUMN_WIDTH + ((start - VIEW_START_MINUTES) / SLOT_MINUTES) * SLOT_WIDTH}px;width:${((end - start) / SLOT_MINUTES) * SLOT_WIDTH}px"></div>
      `);
    });

    shortageRanges(state.date).forEach((range) => {
      const start = timeToMinutes(range.start);
      const end = timeToMinutes(range.end);
      grid.insertAdjacentHTML('beforeend', `
        <div class="shortage-band" style="left:${PERSON_COLUMN_WIDTH + ((start - VIEW_START_MINUTES) / SLOT_MINUTES) * SLOT_WIDTH}px;width:${((end - start) / SLOT_MINUTES) * SLOT_WIDTH}px"></div>
      `);
    });

    renderAggregate(grid, displayedPeople.length);
    updateCurrentTimeLine();
    $('#timelineScroll').scrollLeft = previousScrollLeft;
  }

  function formatShiftDuration(shift) {
    const interval = intervalForShift(shift);
    if (!interval) return '时间格式异常';
    return `${((interval.end - interval.start) / 60).toFixed(1)} 小时`;
  }

  function renderAggregate(grid, peopleRowCount) {
    const aggregate = document.createElement('div');
    aggregate.className = 'aggregate';
    aggregate.style.gridRow = String(Math.max(peopleRowCount, 1) + 2);

    const rows = [
      ['全团队计划在岗', (hour) => coverageCountAt(state.date, hour * 60)],
      ['人力需求', (hour) => demandAtHour(hour)],
      ['缺口（在岗-需求）', (hour) => coverageCountAt(state.date, hour * 60) - demandAtHour(hour)]
    ];

    rows.forEach(([label, calculator], rowIndex) => {
      aggregate.insertAdjacentHTML('beforeend', `
        <div class="aggregate-label" style="grid-row:${rowIndex + 1}">${escapeHtml(label)}</div>
      `);
      for (let hour = 8; hour < 24; hour += 1) {
        const value = calculator(hour);
        const className = rowIndex === 2 ? (value >= 0 ? 'positive' : 'negative') : '';
        aggregate.insertAdjacentHTML('beforeend', `
          <div class="aggregate-value ${className}" style="grid-row:${rowIndex + 1};grid-column:${hour - 6}">
            ${rowIndex === 2 && value > 0 ? '+' : ''}${value}
          </div>
        `);
      }
    });
    grid.append(aggregate);
  }

  function updateCurrentTimeLine() {
    const grid = $('#timelineGrid');
    if (!grid) return;
    grid.querySelector('.now-line')?.remove();

    const now = new Date();
    if (state.date !== isoDate(now)) return;
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (currentMinute < VIEW_START_MINUTES || currentMinute > VIEW_END_MINUTES) return;

    grid.insertAdjacentHTML('beforeend', `
      <div class="now-line" style="left:${PERSON_COLUMN_WIDTH + ((currentMinute - VIEW_START_MINUTES) / SLOT_MINUTES) * SLOT_WIDTH}px">
        <span>${pad(now.getHours())}:${pad(now.getMinutes())}</span>
      </div>
    `);
  }

  function primarySchedule(personId, date) {
    const records = shiftsForPerson(personId, date, false);
    const working = records.find((shift) => shift.status === '工作');
    if (working) return { label: working.shiftName, status: '工作' };
    const priority = ['请假', '培训', '会议', '休息'];
    for (const status of priority) {
      const record = records.find((shift) => shift.status === status);
      if (record) return { label: record.shiftName || status, status };
    }
    return null;
  }

  function renderWeek() {
    const selectedDate = parseIsoDate(state.date) || new Date();
    const weekStart = mondayOf(selectedDate);
    const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const displayedPeople = people.filter((person) => {
      if (state.group !== 'all' && person.group !== state.group) return false;
      if (state.person !== 'all' && person.id !== state.person) return false;
      if (state.skill !== 'all' && person.skill !== state.skill) return false;
      return dates.some((date) => shiftsForPerson(person.id, isoDate(date), false).length > 0);
    });

    $('#weekView').innerHTML = `
      <table class="week-table">
        <thead>
          <tr>
            <th>人员</th>
            ${dates.map((date) => `<th>${escapeHtml(new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date))}<small>${pad(date.getMonth() + 1)}-${pad(date.getDate())}</small></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${displayedPeople.map((person) => `
            <tr>
              <td>
                <button class="week-person" data-person-id="${escapeHtml(person.id)}">
                  <span class="avatar">${escapeHtml(person.avatar || person.name?.[0] || '?')}</span>
                  <span><b>${escapeHtml(person.name)}</b><small>${escapeHtml(person.group)} · ${escapeHtml(person.skill)}</small></span>
                </button>
              </td>
              ${dates.map((date) => {
                const dateIso = isoDate(date);
                const schedule = primarySchedule(person.id, dateIso);
                return `
                  <td>
                    <button class="week-cell ${schedule ? `week-${escapeHtml(schedule.status)}` : 'week-empty'}" data-date="${dateIso}" data-person-id="${escapeHtml(person.id)}">
                      ${schedule ? escapeHtml(schedule.label) : '—'}
                    </button>
                  </td>
                `;
              }).join('')}
            </tr>
          `).join('') || '<tr><td colspan="8" class="week-empty-message">本周暂无排班数据</td></tr>'}
        </tbody>
      </table>
    `;

    $$('.week-person').forEach((button) => {
      button.addEventListener('click', () => {
        const person = people.find((item) => item.id === button.dataset.personId);
        if (person) openDrawer(person);
      });
    });

    $$('.week-cell[data-date]').forEach((button) => {
      button.addEventListener('click', () => {
        state.date = button.dataset.date;
        state.person = button.dataset.personId || 'all';
        $('#dateFilter').value = state.date;
        $('#personFilter').value = optionExists('personFilter', state.person) ? state.person : 'all';
        switchView('day');
        render();
      });
    });
  }

  function renderScheduleHead() {
    $('#scheduleTitle').textContent = currentView === 'day'
      ? `${formatDisplayDate(state.date)}排班轨道`
      : `${formatDisplayDate(state.date)}所在周排班矩阵`;
    $('#scheduleSubtitle').textContent = currentView === 'day'
      ? '时间精度：30 分钟 · 工时已扣除休息、培训、会议和请假重叠时段'
      : '点击某一天可切换到对应日视图';
  }

  function render() {
    renderScheduleHead();
    renderSummary();
    if (currentView === 'day') renderDay();
    else renderWeek();
  }

  function openDrawer(person) {
    const records = shiftsForPerson(person.id, state.date, false);
    const workMinutes = effectiveWorkMinutes(person.id, state.date);
    const output = Math.round((workMinutes / 60) * Number(person.hourlyOutput || 0));
    const selectedDate = parseIsoDate(state.date) || new Date();
    const weekStart = mondayOf(selectedDate);
    const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

    $('#drawerContent').innerHTML = `
      <div class="profile">
        <span class="avatar">${escapeHtml(person.avatar || person.name?.[0] || '?')}</span>
        <span>
          <h3>${escapeHtml(person.name)}</h3>
          <p>${escapeHtml(person.group)} · ${escapeHtml(person.business)} · ${escapeHtml(person.skill)}</p>
        </span>
        <span class="status-online">● ${escapeHtml(currentStatusForPerson(person.id))}</span>
      </div>
      <div class="detail-list">
        ${[
          ['查看日期', state.date],
          ['人员编号', person.id],
          ['今日班次', records.filter((shift) => shift.status === '工作').map((shift) => shift.shiftName).join(' / ') || records.map((shift) => shift.shiftName).join(' / ') || '—'],
          ['有效工时', `${(workMinutes / 60).toFixed(1)} 小时`],
          ['预计产出', `${output} 通`],
          ['单位小时产出', `${Number(person.hourlyOutput || 0)} 通`],
          ['所属小组', person.group],
          ['数据来源', dataSourceName]
        ].map(([label, value]) => `
          <div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
        `).join('')}
      </div>
      <div class="mini-week">
        <h4>本周排班缩略</h4>
        <div class="mini-week-grid">
          ${weekDates.map((date) => {
            const schedule = primarySchedule(person.id, isoDate(date));
            return `<div class="mini-day"><strong>${escapeHtml(new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date))}</strong>${escapeHtml(schedule?.label || '—')}</div>`;
          }).join('')}
        </div>
      </div>
    `;

    $('#detailDrawer').classList.add('open');
    $('#drawerMask').classList.add('open');
    $('#detailDrawer').setAttribute('aria-hidden', 'false');
  }

  function closeDrawer() {
    $('#detailDrawer').classList.remove('open');
    $('#drawerMask').classList.remove('open');
    $('#detailDrawer').setAttribute('aria-hidden', 'true');
  }

  function bindTooltip(element, text) {
    element.addEventListener('mouseenter', (event) => {
      const tooltip = $('#tooltip');
      tooltip.textContent = text;
      tooltip.classList.add('show');
      moveTooltip(event);
    });
    element.addEventListener('mousemove', moveTooltip);
    element.addEventListener('mouseleave', () => $('#tooltip').classList.remove('show'));
  }

  function moveTooltip(event) {
    const tooltip = $('#tooltip');
    tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 12, event.clientX + 14))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - tooltip.offsetHeight - 12, event.clientY + 14))}px`;
  }

  function showToast(message, kind = 'default') {
    const toast = $('#toast');
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function getRaw(row, names) {
    for (const name of names) {
      if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
    }
    return '';
  }

  function normalizeDate(value, fallback = state.date) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return isoDate(value);

    const numeric = Number(value);
    if (String(value).trim() !== '' && Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
      const utcMilliseconds = Math.round((numeric - 25569) * 86400 * 1000);
      const date = new Date(utcMilliseconds);
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }

    const text = String(value || '').trim();
    const match = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
    return fallback;
  }

  function normalizeTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
    }

    const text = String(value ?? '').trim();
    const numeric = Number(text);
    if (text !== '' && Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
      let totalMinutes = Math.round(numeric * 1440);
      if (totalMinutes >= 1440) return '24:00';
      return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
    }

    const match = text.match(/(\d{1,2})[:：](\d{1,2})/);
    if (!match) return text;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour === 24 && minute === 0) return '24:00';
    if (hour > 23 || minute > 59) return text;
    return `${pad(hour)}:${pad(minute)}`;
  }

  function parseRows(rows, fileName) {
    const importedPeople = new Map();
    const importedShifts = [];
    const importErrors = [];

    rows.forEach((row, index) => {
      const name = String(getRaw(row, ['人员姓名', '姓名']) || '').trim();
      const existingByName = people.find((person) => person.name === name);
      const id = String(getRaw(row, ['人员编号', '员工编号', '工号']) || existingByName?.id || `UP${index + 1}`).trim();
      const date = normalizeDate(getRaw(row, ['日期', '排班日期']), state.date);
      const group = String(getRaw(row, ['小组', '组别']) || existingByName?.group || '未分组').trim();
      const skill = String(getRaw(row, ['熟练度', '人员类型']) || existingByName?.skill || '熟练').trim();
      const business = String(getRaw(row, ['所属业务', '业务']) || existingByName?.business || '客服业务').trim();
      const shiftName = String(getRaw(row, ['班次名称', '班次']) || '工作').trim();
      const start = normalizeTime(getRaw(row, ['开始时间', '上班时间']));
      const end = normalizeTime(getRaw(row, ['结束时间', '下班时间']));
      const status = String(getRaw(row, ['状态', '时段类型']) || '工作').trim();
      const hourlyOutputRaw = Number(getRaw(row, ['单位小时产出', '小时产出']));
      const hourlyOutput = Number.isFinite(hourlyOutputRaw) && hourlyOutputRaw > 0
        ? hourlyOutputRaw
        : Number(existingByName?.hourlyOutput || 28);

      if (!name || !start || !end || !Number.isFinite(timeToMinutes(start)) || !Number.isFinite(timeToMinutes(end))) {
        importErrors.push(index + 2);
        return;
      }

      importedPeople.set(id, {
        id,
        name,
        group,
        skill,
        business,
        hourlyOutput,
        avatar: name[0] || '?'
      });

      importedShifts.push({
        id: `U${index + 1}`,
        date,
        personId: id,
        shiftName,
        start,
        end,
        status,
        note: String(getRaw(row, ['备注']) || '').trim()
      });
    });

    if (!importedShifts.length) {
      throw new Error('未识别到有效排班行，请检查人员姓名、开始时间和结束时间');
    }

    people = [...importedPeople.values()];
    shifts = importedShifts.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    dataSourceName = fileName || '上传数据';

    const availableDates = [...new Set(shifts.map((shift) => shift.date))].sort();
    state.date = availableDates.includes(state.date) ? state.date : availableDates[0];
    state.group = 'all';
    state.person = 'all';
    state.shift = 'all';
    state.status = 'all';
    state.skill = 'all';

    $('#dateFilter').value = state.date;
    updateDataSourceBadge();
    initFilters();
    const persisted = persistLocalData();
    render();

    if (importErrors.length) {
      showToast(`已载入 ${importedShifts.length} 条记录；跳过第 ${importErrors.slice(0, 5).join('、')} 行${importErrors.length > 5 ? '等' : ''}`, 'warning');
    } else {
      showToast(`成功载入 ${importedShifts.length} 条排班记录${persisted ? '，已保存到当前浏览器' : ''}`);
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (char === '"' && quoted && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(field);
        field = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && next === '\n') index += 1;
        row.push(field);
        if (row.some((value) => String(value).trim() !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    row.push(field);
    if (row.some((value) => String(value).trim() !== '')) rows.push(row);
    if (!rows.length) return [];

    const headers = rows.shift().map((header) => String(header).trim());
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function downloadTextFile(name, content, type = 'text/csv;charset=utf-8') {
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCurrentSchedule() {
    const visiblePeopleIds = new Set(filteredPeople().map((person) => person.id));
    const exportRows = shifts
      .filter((shift) => shift.date === state.date)
      .filter((shift) => visiblePeopleIds.has(shift.personId))
      .filter((shift) => state.shift === 'all' || shift.shiftName === state.shift)
      .filter((shift) => state.status === 'all' || shift.status === state.status);

    if (!exportRows.length) {
      showToast('当前筛选条件下没有可导出的排班', 'warning');
      return;
    }

    const rows = [[
      '日期', '人员编号', '人员姓名', '小组', '熟练度', '所属业务',
      '班次名称', '开始时间', '结束时间', '状态', '单位小时产出', '备注'
    ]];

    exportRows.forEach((shift) => {
      const person = people.find((item) => item.id === shift.personId);
      if (!person) return;
      rows.push([
        shift.date, person.id, person.name, person.group, person.skill, person.business,
        shift.shiftName, shift.start, shift.end, shift.status, person.hourlyOutput, shift.note || ''
      ]);
    });

    downloadTextFile(
      `客服排班_${state.date}.csv`,
      rows.map((row) => row.map(csvEscape).join(',')).join('\n')
    );
    showToast(`已导出 ${exportRows.length} 条当前筛选排班`);
  }

  function switchView(view) {
    currentView = view;
    $$('.segmented button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    $('#dayView').hidden = view !== 'day';
    $('#weekView').hidden = view !== 'week';
  }

  $('#excelUpload').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.csv')) {
        parseRows(parseCsv(await file.text()), file.name);
      } else {
        if (!window.XLSX) {
          throw new Error('Excel 解析库加载失败，请检查网络，或先另存为 CSV 上传');
        }
        const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: true });
        parseRows(rows, file.name);
      }
    } catch (error) {
      console.error(error);
      showToast(`上传失败：${error.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  });

  $('#downloadTemplate').addEventListener('click', () => {
    const template = [
      ['日期', '人员编号', '人员姓名', '小组', '熟练度', '所属业务', '班次名称', '开始时间', '结束时间', '状态', '单位小时产出', '备注'],
      [isoDate(new Date()), 'CS001', '张雨晴', 'A组', '熟练', '抖音售后', '早班', '08:00', '16:00', '工作', '32', '示例数据'],
      [isoDate(new Date()), 'CS001', '张雨晴', 'A组', '熟练', '抖音售后', '休息', '12:00', '13:00', '休息', '32', '与工作时段重叠时会自动扣除']
    ];
    downloadTextFile('客服排班上传模板.csv', template.map((row) => row.map(csvEscape).join(',')).join('\n'));
  });

  $('#exportCsv').addEventListener('click', exportCurrentSchedule);

  $('#dateFilter').addEventListener('change', (event) => {
    state.date = event.target.value || state.date;
    render();
  });

  [
    ['groupFilter', 'group'],
    ['personFilter', 'person'],
    ['shiftFilter', 'shift'],
    ['statusFilter', 'status'],
    ['skillFilter', 'skill']
  ].forEach(([elementId, stateKey]) => {
    $(`#${elementId}`).addEventListener('change', (event) => {
      state[stateKey] = event.target.value;
      render();
    });
  });

  $('#resetFilters').addEventListener('click', () => {
    state.group = 'all';
    state.person = 'all';
    state.shift = 'all';
    state.status = 'all';
    state.skill = 'all';
    $$('.filter-panel select').forEach((select) => { select.value = 'all'; });
    render();
  });

  $$('.segmented button').forEach((button) => {
    button.addEventListener('click', () => {
      switchView(button.dataset.view);
      render();
    });
  });

  $$('.main-nav button').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.page === 'schedule') {
        $('#schedulePage').classList.add('active-page');
        $('#placeholderPage').classList.remove('active-page');
      } else {
        $('#schedulePage').classList.remove('active-page');
        $('#placeholderPage').classList.add('active-page');
        $('#placeholderTitle').textContent = `${button.textContent} · 建设中`;
      }
      $$('.main-nav button').forEach((item) => item.classList.toggle('active', item === button));
    });
  });

  $('[data-back-schedule]').addEventListener('click', () => $('.main-nav [data-page="schedule"]').click());
  $('#closeDrawer').addEventListener('click', closeDrawer);
  $('#drawerMask').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });

  restoreLocalData();
  $('#dateFilter').value = state.date;
  updateClockHeader();
  updateDataSourceBadge();
  initFilters();
  render();

  setInterval(() => {
    updateClockHeader();
    renderSummary();
    if (currentView === 'day') updateCurrentTimeLine();
  }, 60_000);
})();
