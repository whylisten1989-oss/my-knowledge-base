(() => {
  'use strict';

  const pad = (value) => String(value).padStart(2, '0');
  const toIso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const addDays = (date, amount) => {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  };
  const mondayOf = (date) => {
    const result = new Date(date);
    const day = result.getDay() || 7;
    result.setDate(result.getDate() - day + 1);
    result.setHours(0, 0, 0, 0);
    return result;
  };

  const people = [
    { id: 'CS001', name: '张雨晴', group: 'A组', skill: '熟练', business: '抖音售后', hourlyOutput: 32, avatar: '张' },
    { id: 'CS002', name: '李明轩', group: 'A组', skill: '熟练', business: '抖音售后', hourlyOutput: 30, avatar: '李' },
    { id: 'CS003', name: '王思涵', group: 'A组', skill: '新人', business: '在线咨询', hourlyOutput: 23, avatar: '王' },
    { id: 'CS004', name: '刘宇航', group: 'B组', skill: '熟练', business: '电话服务', hourlyOutput: 31, avatar: '刘' },
    { id: 'CS005', name: '陈佳怡', group: 'B组', skill: '新人', business: '在线咨询', hourlyOutput: 22, avatar: '陈' },
    { id: 'CS006', name: '赵子豪', group: 'A组', skill: '熟练', business: '抖音售后', hourlyOutput: 34, avatar: '赵' },
    { id: 'CS007', name: '周欣妍', group: 'B组', skill: '熟练', business: '在线咨询', hourlyOutput: 29, avatar: '周' },
    { id: 'CS008', name: '吴柏霖', group: 'C组', skill: '熟练', business: '电话服务', hourlyOutput: 33, avatar: '吴' },
    { id: 'CS009', name: '孙艺文', group: 'C组', skill: '新人', business: '在线咨询', hourlyOutput: 21, avatar: '孙' },
    { id: 'CS010', name: '何嘉诚', group: 'C组', skill: '熟练', business: '抖音售后', hourlyOutput: 30, avatar: '何' },
    { id: 'CS011', name: '林小北', group: 'B组', skill: '熟练', business: '在线咨询', hourlyOutput: 28, avatar: '林' },
    { id: 'CS012', name: '郑雅文', group: 'C组', skill: '新人', business: '电话服务', hourlyOutput: 20, avatar: '郑' }
  ];

  const definitions = {
    早班: { start: '08:00', end: '16:00', breakStart: '12:00', breakEnd: '13:00' },
    中班: { start: '12:00', end: '20:00', breakStart: '16:00', breakEnd: '17:00' },
    晚班: { start: '16:00', end: '24:00', breakStart: '20:00', breakEnd: '21:00' }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = mondayOf(today);
  const shifts = [];
  let sequence = 1;

  const addShift = (date, personId, shiftName, start, end, status, note = '') => {
    shifts.push({
      id: `S${sequence++}`,
      date,
      personId,
      shiftName,
      start,
      end,
      status,
      note
    });
  };

  const addWorkDay = (date, person, shiftName, options = {}) => {
    const definition = definitions[shiftName];
    if (!definition) return;
    addShift(date, person.id, shiftName, definition.start, definition.end, '工作');
    if (options.withBreak !== false) {
      addShift(date, person.id, '休息', definition.breakStart, definition.breakEnd, '休息');
    }
    if (options.training) {
      addShift(date, person.id, '培训', options.training.start, options.training.end, '培训');
    }
    if (options.meeting) {
      addShift(date, person.id, '会议', options.meeting.start, options.meeting.end, '会议');
    }
  };

  const rotation = ['早班', '早班', '中班', '中班', '晚班', '休息', '休息'];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const date = toIso(addDays(weekStart, dayIndex));
    people.forEach((person, personIndex) => {
      const planned = rotation[(dayIndex + personIndex * 2) % rotation.length];
      if (planned === '休息') {
        addShift(date, person.id, '休息', '08:00', '24:00', '休息');
        return;
      }
      addWorkDay(date, person, planned, { withBreak: true });
    });
  }

  const todayIso = toIso(today);
  const removeToday = new Set(['CS003', 'CS009', 'CS011', 'CS012']);
  for (let index = shifts.length - 1; index >= 0; index -= 1) {
    if (shifts[index].date === todayIso && removeToday.has(shifts[index].personId)) {
      shifts.splice(index, 1);
    }
  }

  addWorkDay(todayIso, people.find((person) => person.id === 'CS003'), '中班', {
    withBreak: true,
    training: { start: '09:00', end: '11:00' }
  });
  addShift(todayIso, 'CS009', '培训', '09:00', '17:00', '培训');
  addWorkDay(todayIso, people.find((person) => person.id === 'CS011'), '早班', {
    withBreak: true,
    meeting: { start: '14:00', end: '15:00' }
  });
  addShift(todayIso, 'CS012', '请假', '08:00', '24:00', '请假');

  window.WORKFORCE_MOCK = {
    people,
    shifts,
    demand: {
      8: 4, 9: 5, 10: 6, 11: 6, 12: 7, 13: 8, 14: 8, 15: 8,
      16: 9, 17: 8, 18: 8, 19: 7, 20: 6, 21: 5, 22: 4, 23: 3
    },
    peakRanges: [
      { start: '11:30', end: '14:00' },
      { start: '19:30', end: '22:00' }
    ],
    initialDate: todayIso
  };
})();
