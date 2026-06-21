const express = require('express');
const router = express.Router();
const waitlistDao = require('../daos/waitlistDao');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');
const { generateWaitlistNotifySms } = require('../utils/smsGenerator');
const { getAvailableSlotsForEmployee } = require('../utils/slotCalculator');
const { getDateStr } = require('../utils/timeUtils');

const findAvailableSlots = (item) => {
  const service = serviceDao.findById(item.service_id);
  const duration = service ? service.duration_minutes : 60;

  let allSlots = [];

  if (item.employee_id) {
    const slots = getAvailableSlotsForEmployee(item.employee_id, item.preferred_date, duration);
    allSlots = slots.map(s => ({
      ...s,
      employee_id: item.employee_id,
      employee_name: employeeDao.findById(item.employee_id)?.name
    }));
  } else {
    const stylists = employeeDao.findAll({ role: 'stylist', status: 'active' });
    for (const st of stylists) {
      const slots = getAvailableSlotsForEmployee(st.id, item.preferred_date, duration);
      const stylistSlots = slots.map(s => ({
        ...s,
        employee_id: st.id,
        employee_name: st.name
      }));
      allSlots = allSlots.concat(stylistSlots);
      if (allSlots.length >= 6) break;
    }
  }

  return allSlots.slice(0, 6);
};

router.get('/', (req, res) => {
  const { preferred_date, start_date, end_date, status, employee_id } = req.query;
  const filters = {};
  if (preferred_date) filters.preferred_date = preferred_date;
  if (start_date && end_date) {
    filters.start_date = start_date;
    filters.end_date = end_date;
  }
  if (status) filters.status = status;
  if (employee_id) filters.employee_id = parseInt(employee_id);
  const list = waitlistDao.findAll(filters);
  res.json({ code: 0, data: list });
});

router.get('/:id', (req, res) => {
  const item = waitlistDao.findById(parseInt(req.params.id));
  if (!item) {
    return res.status(404).json({ code: 1, message: '候补记录不存在' });
  }
  res.json({ code: 0, data: item });
});

router.post('/', (req, res) => {
  const {
    customer_name, customer_phone, employee_id, service_id,
    preferred_date, preferred_times, hair_note, remark
  } = req.body;

  if (!customer_name || !customer_phone || !service_id || !preferred_date) {
    return res.status(400).json({ code: 1, message: '必填项不完整' });
  }
  if (!serviceDao.findById(parseInt(service_id))) {
    return res.status(400).json({ code: 1, message: '服务项目不存在' });
  }
  if (employee_id && !employeeDao.findById(parseInt(employee_id))) {
    return res.status(400).json({ code: 1, message: '指定发型师不存在' });
  }

  const item = waitlistDao.create({
    customer_name,
    customer_phone,
    employee_id: employee_id ? parseInt(employee_id) : null,
    service_id: parseInt(service_id),
    preferred_date,
    preferred_times: Array.isArray(preferred_times) ? preferred_times.join(',') : preferred_times,
    hair_note,
    remark
  });

  res.json({ code: 0, data: item, message: '已加入候补名单' });
});

router.get('/:id/pre-notify', (req, res) => {
  const id = parseInt(req.params.id);
  const item = waitlistDao.findById(id);
  if (!item) {
    return res.status(404).json({ code: 1, message: '候补记录不存在' });
  }
  if (item.status !== 'waiting') {
    return res.status(400).json({ code: 1, message: `当前状态(${item.status})无法通知` });
  }

  const availableSlots = findAvailableSlots(item);

  if (availableSlots.length === 0) {
    return res.json({
      code: 0,
      has_available: false,
      available_slots: [],
      sms: null,
      message: '当前没有可用空档，请稍后再试'
    });
  }

  const firstSlot = availableSlots[0];
  const sms = generateWaitlistNotifySms(item, firstSlot);

  res.json({
    code: 0,
    has_available: true,
    available_slots: availableSlots,
    sms,
    message: '已查询到可用时段，待顾客确认后即可转为预约'
  });
});

router.post('/:id/notify', (req, res) => {
  const id = parseInt(req.params.id);
  const item = waitlistDao.findById(id);
  if (!item) {
    return res.status(404).json({ code: 1, message: '候补记录不存在' });
  }
  if (item.status !== 'waiting') {
    return res.status(400).json({ code: 1, message: `当前状态(${item.status})无法通知` });
  }

  const availableSlots = findAvailableSlots(item);

  if (availableSlots.length === 0) {
    return res.json({
      code: 0,
      has_available: false,
      available_slots: [],
      sms: null,
      message: '当前没有可用空档，不修改候补状态'
    });
  }

  const firstSlot = availableSlots[0];
  const sms = generateWaitlistNotifySms(item, firstSlot);

  res.json({
    code: 0,
    has_available: true,
    available_slots: availableSlots,
    sms,
    suggested_slot: firstSlot,
    message: '已查询到可用时段，建议使用 /confirm-booking 接口确认后转为正式预约'
  });
});

router.post('/:id/confirm-booking', (req, res) => {
  const id = parseInt(req.params.id);
  const { start_time, employee_id } = req.body;
  const item = waitlistDao.findById(id);

  if (!item) {
    return res.status(404).json({ code: 1, message: '候补记录不存在' });
  }
  if (item.status !== 'waiting' && item.status !== 'notified') {
    return res.status(400).json({ code: 1, message: `当前状态(${item.status})无法转为预约` });
  }
  if (!start_time) {
    return res.status(400).json({ code: 1, message: '必须指定确认的开始时间' });
  }

  const finalEmployeeId = employee_id || item.employee_id;
  if (!finalEmployeeId) {
    return res.status(400).json({ code: 1, message: '必须指定发型师' });
  }

  const service = serviceDao.findById(item.service_id);
  if (!service) {
    return res.status(400).json({ code: 1, message: '服务项目不存在' });
  }

  const { calculateEndTime, calculateTotalPrice, fullValidateBooking } = require('../utils/bookingValidator');
  const bookingDao = require('../daos/bookingDao');

  const end_time = calculateEndTime(start_time, item.service_id);

  const bookingData = {
    customer_name: item.customer_name,
    customer_phone: item.customer_phone,
    employee_id: finalEmployeeId,
    assistant_id: null,
    service_id: item.service_id,
    addon_service_ids: null,
    booking_date: item.preferred_date,
    start_time,
    end_time,
    hair_note: item.hair_note,
    remark: item.remark,
    source: 'waitlist'
  };

  const validation = fullValidateBooking(bookingData);
  if (!validation.valid) {
    return res.status(400).json({ code: 1, message: validation.errors.join('; ') });
  }

  const booking = bookingDao.create({ ...bookingData, status: 'confirmed' });

  const addons = [];
  booking.addon_services = addons;
  booking.total_price = calculateTotalPrice(item.service_id, []);

  waitlistDao.updateStatus(id, 'booked');
  waitlistDao.update(id, {
    confirmed_booking_id: booking.id,
    confirmed_start_time: start_time,
    confirmed_employee_id: finalEmployeeId
  });

  const { generateConfirmSms } = require('../utils/smsGenerator');
  const sms = generateConfirmSms(booking);

  res.json({
    code: 0,
    data: booking,
    sms,
    message: '候补已成功转为预约'
  });
});

router.post('/:id/booked', (req, res) => {
  const id = parseInt(req.params.id);
  const updated = waitlistDao.updateStatus(id, 'booked');
  res.json({ code: 0, data: updated, message: '候补已转为预约' });
});

router.post('/:id/cancel', (req, res) => {
  const id = parseInt(req.params.id);
  const updated = waitlistDao.updateStatus(id, 'cancelled');
  res.json({ code: 0, data: updated, message: '候补已取消' });
});

router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const info = waitlistDao.remove(id);
  if (info.changes === 0) {
    return res.status(404).json({ code: 1, message: '候补记录不存在' });
  }
  res.json({ code: 0, message: '删除成功' });
});

module.exports = router;
