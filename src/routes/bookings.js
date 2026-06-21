const express = require('express');
const router = express.Router();
const bookingDao = require('../daos/bookingDao');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');
const customerDao = require('../daos/customerDao');
const { fullValidateBooking, calculateEndTime, calculateTotalPrice, getCustomerRiskInfo, validateAddonServices, validateAssistant } = require('../utils/bookingValidator');
const { generateConfirmSms, generateCancelSms } = require('../utils/smsGenerator');
const { getDateStr } = require('../utils/timeUtils');
const configDao = require('../daos/configDao');

router.get('/', (req, res) => {
  const { booking_date, start_date, end_date, employee_id, customer_phone, status, is_no_show } = req.query;
  const filters = {};
  if (booking_date) filters.booking_date = booking_date;
  if (start_date && end_date) {
    filters.start_date = start_date;
    filters.end_date = end_date;
  }
  if (employee_id) filters.employee_id = parseInt(employee_id);
  if (customer_phone) filters.customer_phone = customer_phone;
  if (status) {
    filters.status = status.includes(',') ? status.split(',') : status;
  }
  if (is_no_show !== undefined) filters.is_no_show = parseInt(is_no_show);

  const bookings = bookingDao.findAll(filters);

  const enriched = bookings.map(b => {
    const addonIds = b.addon_service_ids ? b.addon_service_ids.split(',').map(Number) : [];
    const addons = addonIds.length ? serviceDao.findByIds(addonIds) : [];
    return {
      ...b,
      addon_services: addons,
      total_price: b.service_price + addons.reduce((s, a) => s + a.price, 0)
    };
  });

  res.json({ code: 0, data: enriched });
});

router.get('/:identifier', (req, res) => {
  const identifier = req.params.identifier;
  let booking;
  if (/^\d+$/.test(identifier)) {
    booking = bookingDao.findById(parseInt(identifier));
  } else {
    booking = bookingDao.findByBookingNo(identifier);
  }
  if (!booking) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  const addonIds = booking.addon_service_ids ? booking.addon_service_ids.split(',').map(Number) : [];
  const addons = addonIds.length ? serviceDao.findByIds(addonIds) : [];
  booking.addon_services = addons;
  booking.total_price = booking.service_price + addons.reduce((s, a) => s + a.price, 0);
  res.json({ code: 0, data: booking });
});

router.post('/', (req, res) => {
  const {
    customer_name, customer_phone, employee_id, assistant_id,
    service_id, addon_service_ids, booking_date, start_time,
    hair_note, remark, source
  } = req.body;

  if (!customer_name || !customer_phone || !employee_id || !service_id || !booking_date || !start_time) {
    return res.status(400).json({ code: 1, message: '必填项不完整' });
  }

  const mainService = serviceDao.findById(parseInt(service_id));
  if (!mainService) {
    return res.status(400).json({ code: 1, message: '主服务项目不存在' });
  }
  if (!mainService.is_active) {
    return res.status(400).json({ code: 1, message: `主服务项目"${mainService.name}"已停用` });
  }

  const stylist = employeeDao.findById(parseInt(employee_id));
  if (!stylist) {
    return res.status(400).json({ code: 1, message: '指定发型师不存在' });
  }
  if (stylist.role !== 'stylist') {
    return res.status(400).json({ code: 1, message: `员工"${stylist.name}"是${stylist.role}，不能作为发型师预约` });
  }
  if (stylist.status !== 'active') {
    return res.status(400).json({ code: 1, message: `发型师"${stylist.name}"当前状态${stylist.status}，不可预约` });
  }

  const addonIds = addon_service_ids
    ? (Array.isArray(addon_service_ids) ? addon_service_ids : String(addon_service_ids).split(',').map(Number))
    : [];

  if (addonIds.length > 0) {
    const addonCheck = validateAddonServices(addonIds);
    if (!addonCheck.valid) {
      return res.status(400).json({ code: 1, message: addonCheck.errors.join('; ') });
    }
  }

  if (assistant_id) {
    const asstCheck = validateAssistant(parseInt(assistant_id));
    if (!asstCheck.valid) {
      return res.status(400).json({ code: 1, message: asstCheck.message });
    }
  }

  const customerProfile = customerDao.getCustomerProfile(customer_phone);
  const riskInfo = getCustomerRiskInfo(customer_phone, source || 'online');

  let depositInfo = {
    required: false,
    amount: 0,
    total_price: 0
  };

  const totalPrice = calculateTotalPrice(parseInt(service_id), addonIds);

  if (mainService.require_deposit) {
    depositInfo.required = true;
    depositInfo.amount = mainService.deposit || Math.round(mainService.price * 0.3);
  }

  if (riskInfo.is_high_risk && source !== 'frontdesk') {
    depositInfo.required = true;
    depositInfo.amount = Math.max(depositInfo.amount, Math.round(totalPrice * 0.5));
  }

  depositInfo.total_price = totalPrice;

  const addonIdsStr = addonIds.length ? addonIds.join(',') : null;
  const end_time = calculateEndTime(start_time, parseInt(service_id), addonIds);

  const bookingData = {
    customer_name,
    customer_phone,
    employee_id: parseInt(employee_id),
    assistant_id: assistant_id ? parseInt(assistant_id) : null,
    service_id: parseInt(service_id),
    addon_service_ids: addonIdsStr,
    booking_date,
    start_time,
    end_time,
    hair_note,
    remark,
    source: source || 'online'
  };

  const validation = fullValidateBooking(bookingData);
  if (!validation.valid) {
    return res.status(400).json({ code: 1, message: validation.errors.join('; ') });
  }

  let finalStatus = 'pending';
  if (source === 'frontdesk') {
    finalStatus = 'confirmed';
  } else if (riskInfo.require_manual_confirm) {
    finalStatus = 'pending_review';
  }

  const depositAmount = depositInfo.amount;
  const depositRequired = depositInfo.required;
  let depositStatus = 'unpaid';
  let depositExpireAt = null;

  if (depositRequired && depositAmount > 0) {
    if (source === 'frontdesk') {
      depositStatus = 'paid';
    } else {
      depositStatus = 'unpaid';
      const expire = new Date();
      expire.setMinutes(expire.getMinutes() + 30);
      depositExpireAt = expire.toISOString();
    }
  } else {
    depositStatus = 'none';
  }

  const booking = bookingDao.create({
    ...bookingData,
    status: finalStatus,
    deposit_amount: depositAmount,
    deposit_status: depositStatus,
    deposit_expire_at: depositExpireAt
  });

  const addons = addonIds.length ? serviceDao.findByIds(addonIds) : [];
  booking.addon_services = addons;
  booking.total_price = totalPrice;
  booking.is_risk = riskInfo.is_high_risk;

  const depositDetail = {
    required: depositRequired,
    amount: depositAmount,
    status: depositStatus,
    expire_at: depositExpireAt,
    total_price: totalPrice
  };

  let sms = null;
  if (finalStatus === 'confirmed') {
    sms = generateConfirmSms(booking);
  } else if (finalStatus === 'pending_review') {
    const template = configDao.getConfig('sms_template_risk');
    const storeName = configDao.getConfig('store_name');
    sms = {
      phone: customer_phone,
      content: template
        .replace(/\{store_name\}/g, storeName)
        .replace(/\{customer_name\}/g, customer_name)
    };
  }

  const customerSummary = {
    total_bookings: customerProfile.total_bookings,
    completed_bookings: customerProfile.completed_bookings,
    no_show_count: customerProfile.no_show_count,
    total_spent: customerProfile.total_spent,
    preferred_stylist: customerProfile.preferred_stylist,
    top_services: customerProfile.top_services,
    hair_notes: customerProfile.hair_notes,
    recent_bookings: customerProfile.recent_bookings,
    recent_consumptions: customerProfile.recent_consumptions,
    last_arrival_date: customerProfile.last_arrival_date,
    last_no_show: customerProfile.last_no_show,
    first_booking_date: customerProfile.first_booking_date,
    last_booking_date: customerProfile.last_booking_date
  };

  res.json({
    code: 0,
    data: booking,
    sms,
    customer_info: {
      profile: customerProfile,
      risk: riskInfo,
      summary: customerSummary
    },
    deposit: depositDetail,
    message: finalStatus === 'pending_review'
      ? '预约已提交，需人工确认'
      : (finalStatus === 'confirmed' ? '预约创建成功' : '预约已提交，待确认')
  });
});

router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }

  const {
    customer_name, customer_phone, employee_id, assistant_id,
    service_id, addon_service_ids, booking_date, start_time,
    hair_note, remark, status
  } = req.body;

  const mainService = serviceDao.findById(parseInt(service_id || existing.service_id));
  if (!mainService) {
    return res.status(400).json({ code: 1, message: '服务项目不存在' });
  }

  const addonIds = addon_service_ids
    ? (Array.isArray(addon_service_ids) ? addon_service_ids : String(addon_service_ids).split(',').map(Number))
    : (existing.addon_service_ids ? existing.addon_service_ids.split(',').map(Number) : []);

  const addonIdsStr = addonIds.length ? addonIds.join(',') : null;
  const finalStartTime = start_time || existing.start_time;
  const end_time = calculateEndTime(finalStartTime, parseInt(service_id || existing.service_id), addonIds);

  const bookingData = {
    customer_name: customer_name || existing.customer_name,
    customer_phone: customer_phone || existing.customer_phone,
    employee_id: parseInt(employee_id || existing.employee_id),
    assistant_id: assistant_id !== undefined ? (assistant_id ? parseInt(assistant_id) : null) : existing.assistant_id,
    service_id: parseInt(service_id || existing.service_id),
    addon_service_ids: addonIdsStr,
    booking_date: booking_date || existing.booking_date,
    start_time: finalStartTime,
    end_time,
    hair_note: hair_note !== undefined ? hair_note : existing.hair_note,
    remark: remark !== undefined ? remark : existing.remark,
    status: status || existing.status
  };

  const needTimeCheck = (
    bookingData.employee_id !== existing.employee_id ||
    bookingData.booking_date !== existing.booking_date ||
    bookingData.start_time !== existing.start_time ||
    bookingData.end_time !== existing.end_time ||
    bookingData.customer_phone !== existing.customer_phone
  );

  if (needTimeCheck) {
    const validation = fullValidateBooking(bookingData, id);
    if (!validation.valid) {
      return res.status(400).json({ code: 1, message: validation.errors.join('; ') });
    }
  }

  const updated = bookingDao.update(id, bookingData);
  updated.addon_services = addonIds.length ? serviceDao.findByIds(addonIds) : [];
  updated.total_price = calculateTotalPrice(bookingData.service_id, addonIds);

  res.json({ code: 0, data: updated, message: '预约更新成功' });
});

router.post('/:id/reschedule', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }

  const { booking_date, start_time, employee_id } = req.body;
  if (!booking_date || !start_time) {
    return res.status(400).json({ code: 1, message: '新日期和开始时间必填' });
  }

  const addonIds = existing.addon_service_ids ? existing.addon_service_ids.split(',').map(Number) : [];
  const end_time = calculateEndTime(start_time, existing.service_id, addonIds);
  const newEmployeeId = employee_id ? parseInt(employee_id) : existing.employee_id;

  const bookingData = {
    customer_name: existing.customer_name,
    customer_phone: existing.customer_phone,
    employee_id: newEmployeeId,
    assistant_id: existing.assistant_id,
    service_id: existing.service_id,
    addon_service_ids: existing.addon_service_ids,
    booking_date,
    start_time,
    end_time,
    hair_note: existing.hair_note,
    remark: existing.remark,
    status: 'rescheduled'
  };

  const validation = fullValidateBooking(bookingData, id);
  if (!validation.valid) {
    return res.status(400).json({ code: 1, message: validation.errors.join('; ') });
  }

  const updated = bookingDao.update(id, { ...bookingData, status: existing.status === 'cancelled' ? existing.status : 'confirmed' });
  updated.addon_services = addonIds.length ? serviceDao.findByIds(addonIds) : [];

  const confirmSms = generateConfirmSms(updated);

  res.json({
    code: 0,
    data: updated,
    sms: confirmSms,
    message: '改期成功'
  });
});

router.post('/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (existing.status === 'completed' || existing.status === 'no_show') {
    return res.status(400).json({ code: 1, message: `当前状态(${existing.status})无法取消` });
  }
  const { reason } = req.body;
  const updated = bookingDao.updateStatus(id, 'cancelled');
  if (reason && updated) {
    updated.cancel_reason = reason;
  }
  const cancelSms = generateCancelSms(existing);
  res.json({
    code: 0,
    data: updated,
    sms: cancelSms,
    message: '取消成功'
  });
});

router.post('/:id/arrive', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (!['pending', 'confirmed'].includes(existing.status)) {
    return res.status(400).json({ code: 1, message: `当前状态(${existing.status})无法标记到店` });
  }
  const updated = bookingDao.updateStatus(id, 'arrived');
  res.json({ code: 0, data: updated, message: '已标记到店' });
});

router.post('/:id/confirm', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (existing.status !== 'pending' && existing.status !== 'pending_review') {
    return res.status(400).json({ code: 1, message: `当前状态(${existing.status})无法确认` });
  }
  const updated = bookingDao.updateStatus(id, 'confirmed');
  const confirmSms = generateConfirmSms(updated);
  res.json({
    code: 0,
    data: updated,
    sms: confirmSms,
    message: '已确认预约'
  });
});

router.post('/:id/complete', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (existing.status !== 'arrived') {
    return res.status(400).json({ code: 1, message: `当前状态(${existing.status})无法完成` });
  }
  const updated = bookingDao.updateStatus(id, 'completed');
  res.json({ code: 0, data: updated, message: '服务已完成' });
});

router.post('/:id/no-show', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  const { reason } = req.body;
  const updated = bookingDao.markNoShow(id);
  if (reason) {
    bookingDao.update(id, { no_show_reason: reason });
    updated.no_show_reason = reason;
  }
  res.json({ code: 0, data: updated, message: '已标记爽约' });
});

router.post('/:id/deposit/pay', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (existing.deposit_amount <= 0) {
    return res.status(400).json({ code: 1, message: '该预约无需支付订金' });
  }
  if (existing.deposit_status === 'paid') {
    return res.status(400).json({ code: 1, message: '订金已支付，请勿重复操作' });
  }
  if (existing.deposit_status === 'refunded') {
    return res.status(400).json({ code: 1, message: '订金已退款，无法再次支付' });
  }
  if (existing.deposit_status === 'used') {
    return res.status(400).json({ code: 1, message: '订金已抵扣，无法再次支付' });
  }
  const { note } = req.body;
  const updated = bookingDao.payDeposit(id, note);
  res.json({ code: 0, data: updated, message: '订金已标记为已收' });
});

router.post('/:id/deposit/refund', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (existing.deposit_status !== 'paid') {
    return res.status(400).json({ code: 1, message: `当前订金状态(${existing.deposit_status})无法退款` });
  }
  const { note } = req.body;
  const updated = bookingDao.refundDeposit(id, note);
  res.json({ code: 0, data: updated, message: '订金已退款' });
});

router.post('/:id/deposit/use', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = bookingDao.findById(id);
  if (!existing) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (existing.deposit_status !== 'paid') {
    return res.status(400).json({ code: 1, message: `当前订金状态(${existing.deposit_status})无法抵扣` });
  }
  const { note } = req.body;
  const updated = bookingDao.useDeposit(id, note);
  res.json({ code: 0, data: updated, message: '订金已转为到店抵扣' });
});

module.exports = router;
