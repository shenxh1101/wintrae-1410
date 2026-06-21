const express = require('express');
const router = express.Router();
const waitlistDao = require('../daos/waitlistDao');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');
const { generateWaitlistNotifySms } = require('../utils/smsGenerator');
const { getAvailableSlotsForEmployee } = require('../utils/slotCalculator');
const { getDateStr } = require('../utils/timeUtils');

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

router.post('/:id/notify', (req, res) => {
  const id = parseInt(req.params.id);
  const item = waitlistDao.findById(id);
  if (!item) {
    return res.status(404).json({ code: 1, message: '候补记录不存在' });
  }
  if (item.status !== 'waiting') {
    return res.status(400).json({ code: 1, message: `当前状态(${item.status})无法通知` });
  }

  const service = serviceDao.findById(item.service_id);
  const duration = service ? service.duration_minutes : 60;

  let availableSlot = null;
  let availableSlots = [];

  if (item.employee_id) {
    availableSlots = getAvailableSlotsForEmployee(item.employee_id, item.preferred_date, duration);
  } else {
    const stylists = employeeDao.findAll({ role: 'stylist', status: 'active' });
    for (const st of stylists) {
      const slots = getAvailableSlotsForEmployee(st.id, item.preferred_date, duration);
      if (slots.length > 0) {
        availableSlots = slots.map(s => ({ ...s, employee_name: st.name, employee_id: st.id }));
        break;
      }
    }
  }

  if (availableSlots.length > 0) {
    availableSlot = availableSlots[0];
  }

  const updated = waitlistDao.updateStatus(id, 'notified');
  const sms = generateWaitlistNotifySms(item, availableSlot || { start_time: '最新时段', employee_name: '指定发型师' });

  res.json({
    code: 0,
    data: updated,
    sms,
    available_slot: availableSlot,
    all_available: availableSlots,
    message: '已通知候补顾客'
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
