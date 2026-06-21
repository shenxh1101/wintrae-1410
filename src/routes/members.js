const express = require('express');
const router = express.Router();
const memberDao = require('../daos/memberDao');
const memberCardDao = require('../daos/memberCardDao');

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

module.exports = router;
