const dayjs = require('dayjs');

const timeToMinutes = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const addMinutesToTime = (timeStr, minutes) => {
  const total = timeToMinutes(timeStr) + minutes;
  return minutesToTime(total);
};

const isTimeBetween = (time, start, end, includeStart = true, includeEnd = false) => {
  const t = timeToMinutes(time);
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (includeStart && includeEnd) return t >= s && t <= e;
  if (includeStart) return t >= s && t < e;
  if (includeEnd) return t > s && t <= e;
  return t > s && t < e;
};

const doRangesOverlap = (start1, end1, start2, end2) => {
  return timeToMinutes(start1) < timeToMinutes(end2) && timeToMinutes(end1) > timeToMinutes(start2);
};

const generateTimeSlots = (startTime, endTime, intervalMinutes) => {
  const slots = [];
  let current = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  while (current < end) {
    slots.push(minutesToTime(current));
    current += intervalMinutes;
  }
  return slots;
};

const getDateStr = (date = new Date()) => {
  return dayjs(date).format('YYYY-MM-DD');
};

const formatDateCN = (dateStr) => {
  const d = dayjs(dateStr);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.format('M月D日')} ${weekdays[d.day()]}`;
};

const isFutureDate = (dateStr) => {
  return dayjs(dateStr).isAfter(dayjs().format('YYYY-MM-DD'));
};

const isToday = (dateStr) => {
  return dateStr === dayjs().format('YYYY-MM-DD');
};

module.exports = {
  timeToMinutes,
  minutesToTime,
  addMinutesToTime,
  isTimeBetween,
  doRangesOverlap,
  generateTimeSlots,
  getDateStr,
  formatDateCN,
  isFutureDate,
  isToday
};
