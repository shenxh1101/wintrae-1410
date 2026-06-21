const express = require('express');
const router = express.Router();
const bookingDao = require('../daos/bookingDao');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');
const { fullValidateBooking, calculateEndTime, calculateTotalPrice } = require('../utils/bookingValidator');
const { generateConfirmSms, generateCancelSms } = require('../utils/smsGenerator');
const { getDateStr } = require('../utils/timeUtils');

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

  if (!employeeDao.findById(parseInt(employee_id))) {
    return res.status(400).json({ code: 1, message: '指定发型师不存在' });
  }

  if (assistant_id && !employeeDao.findById(parseInt(assistant_id))) {
    return res.status(400).json({ code: 1, message: '指定助理不存在' });
  }

  const addonIds = addon_service_ids
    ? (Array.isArray(addon_service_ids) ? addon_service_ids : String(addon_service_ids).split(',').map(Number))
    : [];

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

  const booking = bookingDao.create(bookingData);

  const addons = addonIds.length ? serviceDao.findByIds(addonIds) : [];
  booking.addon_services = addons;
  booking.total_price = calculateTotalPrice(parseInt(service_id), addonIds);

  const confirmSms = generateConfirmSms(booking);

  res.json({
    code: 0,
    data: booking,
    sms: confirmSms,
    message: '预约创建成功'
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
  if (existing.status !== 'pending') {
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
  const updated = bookingDao.markNoShow(id);
  res.json({ code: 0, data: updated, message: '已标记爽约' });
});

module.exports = router;
