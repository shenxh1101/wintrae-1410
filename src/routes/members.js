const express = require('express');
const router = express.Router();
const memberDao = require('../daos/memberDao');
const memberCardDao = require('../daos/memberCardDao');
const transactionDao = require('../daos/transactionDao');
const bookingDao = require('../daos/bookingDao');
const serviceDao = require('../daos/serviceDao');
const employeeDao = require('../daos/employeeDao');

router.get('/', (req, res) => {
  const { phone, status } = req.query;
  const filters = {};
  if (phone) filters.phone = phone;
  if (status) filters.status = status;
  const members = memberDao.findAll(filters);
  for (const m of members) {
    m.cards = memberCardDao.findAll({ phone: m.phone, status: 'active' });
  }
  res.json({ code: 0, data: members });
});

router.get('/:phone', (req, res) => {
  const { phone } = req.params;
  const member = memberDao.findByPhone(phone);
  const cards = memberCardDao.findAll({ phone, status: 'active' });
  if (!member) {
    return res.json({ code: 0, data: { exists: false, phone, stored_value: 0, cards: [] } });
  }
  res.json({
    code: 0,
    data: {
      exists: true,
      ...member,
      cards
    }
  });
});

router.post('/', (req, res) => {
  const { name, phone, stored_value, remark, level } = req.body;
  if (!phone) {
    return res.status(400).json({ code: 1, message: '手机号必填' });
  }
  if (memberDao.findByPhone(phone)) {
    return res.status(400).json({ code: 1, message: '该手机号已注册会员' });
  }
  const member = memberDao.create({ name, phone, stored_value, remark, level });
  res.json({ code: 0, data: member, message: '会员创建成功' });
});

router.post('/recharge', (req, res) => {
  const { phone, amount, operator } = req.body;
  if (!phone || !amount) {
    return res.status(400).json({ code: 1, message: '手机号和充值金额必填' });
  }
  const result = memberDao.recharge(phone, parseFloat(amount), operator);
  if (!result.success) {
    return res.status(400).json({ code: 1, message: result.message });
  }
  res.json({ code: 0, data: result.data, message: result.message });
});

router.get('/:phone/cards', (req, res) => {
  const { phone } = req.params;
  const { service_id, status } = req.query;
  const filters = { phone };
  if (service_id) filters.service_id = parseInt(service_id);
  if (status) filters.status = status;
  const cards = memberCardDao.findAll(filters);
  res.json({ code: 0, data: cards });
});

router.post('/cards/purchase', (req, res) => {
  const { phone, name, service_id, total_count, paid_amount, expire_date, remark } = req.body;
  if (!phone || !service_id || !total_count) {
    return res.status(400).json({ code: 1, message: '手机号、服务项目ID、购买次数必填' });
  }
  const result = memberCardDao.purchase(
    phone,
    name,
    parseInt(service_id),
    parseInt(total_count),
    parseFloat(paid_amount) || 0,
    expire_date,
    remark
  );
  if (!result.success) {
    return res.status(400).json({ code: 1, message: result.message });
  }
  res.json({ code: 0, data: result.data, message: result.message });
});

router.get('/:phone/timeline', (req, res) => {
  const { phone } = req.params;
  const { start_date, end_date } = req.query;
  const txnFilters = { customer_phone: phone };
  if (start_date) txnFilters.start_date = start_date;
  if (end_date) txnFilters.end_date = end_date;
  const txns = transactionDao.findAll(txnFilters);
  const timeline = txns.map(t => {
    const booking = t.booking_id ? bookingDao.findById(t.booking_id) : null;
    const emp = booking && booking.employee_id ? employeeDao.findById(booking.employee_id) : null;
    const svc = booking && booking.service_id ? serviceDao.findById(booking.service_id) : null;
    const addonIds = booking && booking.addon_service_ids
      ? booking.addon_service_ids.split(',').map(Number)
      : [];
    const addons = addonIds.length ? serviceDao.findByIds(addonIds) : [];
    const benefits = [];
    if (t.deposit_used > 0) benefits.push({ type: 'deposit', label: '订金抵扣', amount: t.deposit_used });
    if (t.stored_value_used > 0) benefits.push({ type: 'stored_value', label: '储值扣款', amount: t.stored_value_used });
    if ((t.service_card_used_count || 0) > 0) {
      let cardDetail = [];
      try { cardDetail = t.service_card_used_detail ? JSON.parse(t.service_card_used_detail) : []; } catch (e) {}
      benefits.push({
        type: 'service_card',
        label: '次卡扣次',
        count: t.service_card_used_count,
        detail: cardDetail
      });
    }
    return {
      record_id: t.id,
      transaction_no: t.transaction_no,
      time: t.created_at || t.transaction_date,
      date: t.transaction_date,
      txn_type: t.txn_type,
      type_label: t.type_label,
      amount: t.actual_amount,
      remark: t.remark,
      payment_method: t.payment_method,
      amount_breakdown: {
        service_total: t.service_total,
        addon_total: t.addon_total,
        total_amount: t.total_amount,
        discount_amount: t.discount_amount,
        deposit_used: t.deposit_used,
        stored_value_used: t.stored_value_used,
        service_card_used_count: t.service_card_used_count,
        actual_amount: t.actual_amount
      },
      benefits_used: benefits,
      booking: booking ? {
        booking_id: booking.id,
        booking_no: booking.booking_no,
        booking_date: booking.booking_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        status: booking.status
      } : null,
      stylist: emp ? { id: emp.id, name: emp.name, role: emp.role } : null,
      main_service: svc ? { id: svc.id, name: svc.name, price: svc.price } : null,
      addon_services: addons.map(a => ({ id: a.id, name: a.name, price: a.price }))
    };
  });
  res.json({
    code: 0,
    data: {
      phone,
      total_records: timeline.length,
      timeline
    }
  });
});

module.exports = router;
