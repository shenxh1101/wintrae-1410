const { timeToMinutes, doRangesOverlap, isTimeBetween } = require('./timeUtils');
const configDao = require('../daos/configDao');
const scheduleDao = require('../daos/scheduleDao');
const bookingDao = require('../daos/bookingDao');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');
const customerDao = require('../daos/customerDao');

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

const validateAddonServices = (addonIds) => {
  if (!addonIds || addonIds.length === 0) {
    return { valid: true };
  }
  const errors = [];
  const addons = serviceDao.findByIds(addonIds);
  const foundIds = addons.map(a => a.id);

  for (const id of addonIds) {
    if (!foundIds.includes(id)) {
      errors.push(`加做项目ID=${id} 不存在`);
      continue;
    }
    const svc = addons.find(a => a.id === id);
    if (!svc.is_active) {
      errors.push(`加做项目"${svc.name}"已停用`);
    }
  }

  return { valid: errors.length === 0, errors, valid_addons: addons.filter(a => a.is_active) };
};

const validateAssistant = (assistantId) => {
  if (!assistantId) {
    return { valid: true };
  }
  const emp = employeeDao.findById(assistantId);
  if (!emp) {
    return { valid: false, message: `指定助理ID=${assistantId} 不存在` };
  }
  if (emp.role !== 'assistant') {
    return { valid: false, message: `员工"${emp.name}"角色是${emp.role}，不能作为助理` };
  }
  if (emp.status !== 'active') {
    return { valid: false, message: `助理"${emp.name}"当前状态${emp.status}，不在岗` };
  }
  return { valid: true, assistant: emp };
};

const getCustomerRiskInfo = (customerPhone, source = 'online') => {
  const profile = customerDao.getCustomerProfile(customerPhone);
  const threshold = parseInt(configDao.getConfig('no_show_threshold') || '2', 10);

  const isHighRisk = source === 'online' && profile.no_show_count >= threshold;
  const shouldRequireManualConfirm = isHighRisk;

  let depositRequired = false;
  let depositAmount = 0;

  return {
    no_show_count: profile.no_show_count,
    no_show_threshold: threshold,
    is_high_risk: isHighRisk,
    require_manual_confirm: shouldRequireManualConfirm,
    total_bookings: profile.total_bookings,
    total_spent: profile.total_spent,
    preferred_stylist: profile.preferred_stylist,
    hair_notes: profile.hair_notes,
    deposit_required: depositRequired,
    deposit_amount: depositAmount
  };
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

const fullValidateBooking = (bookingData, excludeBookingId = null, checkAddons = true, checkAssistant = true) => {
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

  if (checkAddons && bookingData.addon_service_ids) {
    const addonIds = Array.isArray(bookingData.addon_service_ids)
      ? bookingData.addon_service_ids
      : String(bookingData.addon_service_ids).split(',').map(Number);
    const addonCheck = validateAddonServices(addonIds);
    if (!addonCheck.valid) errors.push(...addonCheck.errors);
  }

  if (checkAssistant && bookingData.assistant_id) {
    const asstCheck = validateAssistant(bookingData.assistant_id);
    if (!asstCheck.valid) errors.push(asstCheck.message);
  }

  return { valid: errors.length === 0, errors };
};

module.exports = {
  validateBusinessHours,
  validateSchedule,
  validateBookingConflict,
  validateDuplicateCustomer,
  validateAddonServices,
  validateAssistant,
  getCustomerRiskInfo,
  calculateEndTime,
  calculateTotalPrice,
  fullValidateBooking
};
