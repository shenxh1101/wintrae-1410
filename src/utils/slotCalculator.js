const { timeToMinutes, minutesToTime, addMinutesToTime, generateTimeSlots, doRangesOverlap } = require('./timeUtils');
const configDao = require('../daos/configDao');
const scheduleDao = require('../daos/scheduleDao');
const bookingDao = require('../daos/bookingDao');
const employeeDao = require('../daos/employeeDao');

const getAvailableSlotsForEmployee = (employeeId, date, requiredDuration = 0) => {
  const schedule = scheduleDao.findByEmployeeAndDate(employeeId, date);
  if (!schedule || schedule.is_day_off) {
    return [];
  }

  const interval = parseInt(configDao.getConfig('time_slot_interval') || '15', 10);
  const workStart = schedule.start_time;
  const workEnd = schedule.end_time;

  let workPeriods = [[workStart, workEnd]];
  if (schedule.break_start && schedule.break_end) {
    workPeriods = [
      [workStart, schedule.break_start],
      [schedule.break_end, workEnd]
    ].filter(([s, e]) => timeToMinutes(s) < timeToMinutes(e));
  }

  const bookings = bookingDao.findAll({
    employee_id: employeeId,
    booking_date: date,
    status: ['pending', 'confirmed', 'arrived']
  }).map(b => ({ start: b.start_time, end: b.end_time }));

  const availableSlots = [];

  for (const [periodStart, periodEnd] of workPeriods) {
    const allSlots = generateTimeSlots(periodStart, periodEnd, interval);

    for (const slotStart of allSlots) {
      const slotEnd = addMinutesToTime(slotStart, requiredDuration || interval);

      if (timeToMinutes(slotEnd) > timeToMinutes(periodEnd)) continue;

      let hasConflict = false;
      for (const booking of bookings) {
        if (doRangesOverlap(slotStart, slotEnd, booking.start, booking.end)) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        availableSlots.push({
          start_time: slotStart,
          end_time: slotEnd
        });
      }
    }
  }

  const merged = [];
  for (const slot of availableSlots) {
    if (merged.length > 0 && merged[merged.length - 1].end_time === slot.start_time) {
      merged[merged.length - 1].end_time = slot.end_time;
    } else {
      merged.push({ ...slot });
    }
  }

  const result = [];
  for (const block of merged) {
    let current = block.start_time;
    while (timeToMinutes(current) < timeToMinutes(block.end_time)) {
      const slotEnd = requiredDuration > 0
        ? addMinutesToTime(current, requiredDuration)
        : addMinutesToTime(current, interval);

      if (timeToMinutes(slotEnd) <= timeToMinutes(block.end_time)) {
        result.push({
          start_time: current,
          end_time: slotEnd,
          employee_id: employeeId,
          date
        });
      }
      current = addMinutesToTime(current, interval);
    }
  }

  return result;
};

const getAvailableSlotsForService = (date, serviceDuration, employeeIds = null) => {
  const stylists = employeeDao.findAll({ role: 'stylist', status: 'active' });
  const targetStylists = employeeIds
    ? stylists.filter(s => employeeIds.includes(s.id))
    : stylists;

  const result = {};

  for (const stylist of targetStylists) {
    const slots = getAvailableSlotsForEmployee(stylist.id, date, serviceDuration);
    if (slots.length > 0) {
      result[stylist.id] = {
        employee_id: stylist.id,
        employee_name: stylist.name,
        station_number: stylist.station_number,
        slots
      };
    }
  }

  return result;
};

const getFreePeriodsForEmployee = (employeeId, date) => {
  const schedule = scheduleDao.findByEmployeeAndDate(employeeId, date);
  if (!schedule || schedule.is_day_off) {
    return [];
  }

  const workStart = schedule.start_time;
  const workEnd = schedule.end_time;

  let segments = [[workStart, workEnd]];
  if (schedule.break_start && schedule.break_end) {
    segments = [
      [workStart, schedule.break_start],
      [schedule.break_end, workEnd]
    ].filter(([s, e]) => timeToMinutes(s) < timeToMinutes(e));
  }

  const bookings = bookingDao.findAll({
    employee_id: employeeId,
    booking_date: date,
    status: ['pending', 'confirmed', 'arrived']
  }).sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

  const freePeriods = [];

  for (const [segStart, segEnd] of segments) {
    let cursor = segStart;
    const segBookings = bookings.filter(b =>
      doRangesOverlap(b.start_time, b.end_time, segStart, segEnd)
    );

    for (const booking of segBookings) {
      const bStart = timeToMinutes(booking.start_time) > timeToMinutes(segStart)
        ? booking.start_time : segStart;
      if (timeToMinutes(cursor) < timeToMinutes(bStart)) {
        freePeriods.push({
          start_time: cursor,
          end_time: bStart,
          duration_minutes: timeToMinutes(bStart) - timeToMinutes(cursor)
        });
      }
      cursor = timeToMinutes(booking.end_time) > timeToMinutes(cursor)
        ? booking.end_time : cursor;
    }

    if (timeToMinutes(cursor) < timeToMinutes(segEnd)) {
      freePeriods.push({
        start_time: cursor,
        end_time: segEnd,
        duration_minutes: timeToMinutes(segEnd) - timeToMinutes(cursor)
      });
    }
  }

  return freePeriods;
};

module.exports = {
  getAvailableSlotsForEmployee,
  getAvailableSlotsForService,
  getFreePeriodsForEmployee
};
