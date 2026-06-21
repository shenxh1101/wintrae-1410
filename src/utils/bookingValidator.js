const { timeToMinutes, doRangesOverlap, isTimeBetween } = require('./timeUtils');
const configDao = require('../daos/configDao');
const scheduleDao = require('../daos/scheduleDao');
const bookingDao = require('../daos/bookingDao');
const serviceDao = require('../daos/serviceDao');

const validateBusinessHours = (startTime, endTime) => {
  const businessStart = configDao.getConfig('business_start');
  const businessEnd = configDao.getConfig('business_end');

  if (timeToMinutes(startTime) < timeToMinutes(businessStart)) {
    return { valid: false, message: `开始时间${startTime}早于营业时间${businessStart}` };
  }
  if (timeToMinutes(endTime) > timeToMinutes(businessEnd)) {
    return { valid: false, message: `结束时间${endTime}晚于营业时间${businessEnd}` };
  }
  return { valid: true };
};

const validateSchedule = (employeeId, date, startTime, endTime) => {
  const schedule = scheduleDao.findByEmployeeAndDate(employeeId, date);

  if (!schedule) {
    return { valid: false, message: '该发型师当日未排班' };
  }

  if (schedule.is_day_off) {
    return { valid: false, message: '该发型师当日休息' };
  }

  if (!doRangesOverlap(startTime, endTime, schedule.start_time, schedule.end_time) ||
      timeToMinutes(startTime) < timeToMinutes(schedule.start_time) ||
      timeToMinutes(endTime) > timeToMinutes(schedule.end_time)) {
    return {
      valid: false,
      message: `预约时段(${startTime}-${endTime})超出排班时间(${schedule.start_time}-${schedule.end_time})`
    };
  }

  if (schedule.break_start && schedule.break_end) {
    if (doRangesOverlap(startTime, endTime, schedule.break_start, schedule.break_end)) {
      return {
        valid: false,
        message: `预约时段与休息时间(${schedule.break_start}-${schedule.break_end})冲突`
      };
    }
  }

  return { valid: true, schedule };
};

const validateBookingConflict = (employeeId, date, startTime, endTime, excludeBookingId = null) => {
  const overlaps = bookingDao.findOverlapping(employeeId, date, startTime, endTime, excludeBookingId);

  if (overlaps.length > 0) {
    const conflict = overlaps[0];
    return {
      valid: false,
      message: `与现有预约(编号${conflict.booking_no}, ${conflict.start_time}-${conflict.end_time})时间冲突`
    };
  }
  return { valid: true };
};

const validateDuplicateCustomer = (customerPhone, date, excludeBookingId = null) => {
  const existing = bookingDao.findCustomerSameDate(customerPhone, date, excludeBookingId);

  if (existing.length > 0) {
    const first = existing[0];
    return {
      valid: false,
      message: `该顾客(${customerPhone})当日已有预约(编号${first.booking_no}, ${first.start_time}-${first.end_time})`
    };
  }
  return { valid: true };
};

const calculateEndTime = (startTime, serviceId, addonIds = []) => {
  const mainService = serviceDao.findById(serviceId);
  if (!mainService) {
    throw new Error(`服务项目不存在: ${serviceId}`);
  }
  let totalMinutes = mainService.duration_minutes;

  if (addonIds && addonIds.length > 0) {
    const addons = serviceDao.findByIds(addonIds);
    for (const addon of addons) {
      totalMinutes += addon.duration_minutes;
    }
  }

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = startMinutes + totalMinutes;
  const endH = Math.floor(endMinutes / 60);
  const endM = endMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
};

const calculateTotalPrice = (serviceId, addonIds = []) => {
  const mainService = serviceDao.findById(serviceId);
  if (!mainService) {
    throw new Error(`服务项目不存在: ${serviceId}`);
  }
  let total = mainService.price;

  if (addonIds && addonIds.length > 0) {
    const addons = serviceDao.findByIds(addonIds);
    for (const addon of addons) {
      total += addon.price;
    }
  }
  return total;
};

const fullValidateBooking = (bookingData, excludeBookingId = null) => {
  const errors = [];

  const hoursCheck = validateBusinessHours(bookingData.start_time, bookingData.end_time);
  if (!hoursCheck.valid) errors.push(hoursCheck.message);

  const scheduleCheck = validateSchedule(
    bookingData.employee_id,
    bookingData.booking_date,
    bookingData.start_time,
    bookingData.end_time
  );
  if (!scheduleCheck.valid) errors.push(scheduleCheck.message);

  const conflictCheck = validateBookingConflict(
    bookingData.employee_id,
    bookingData.booking_date,
    bookingData.start_time,
    bookingData.end_time,
    excludeBookingId
  );
  if (!conflictCheck.valid) errors.push(conflictCheck.message);

  const dupCheck = validateDuplicateCustomer(
    bookingData.customer_phone,
    bookingData.booking_date,
    excludeBookingId
  );
  if (!dupCheck.valid) errors.push(dupCheck.message);

  return { valid: errors.length === 0, errors };
};

module.exports = {
  validateBusinessHours,
  validateSchedule,
  validateBookingConflict,
  validateDuplicateCustomer,
  calculateEndTime,
  calculateTotalPrice,
  fullValidateBooking
};
