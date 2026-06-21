const db = require('../db');
const transactionDao = require('./transactionDao');

const findAll = (filters = {}) => {
  let rows = db.findAll('members');
  if (filters.phone !== undefined) {
    rows = rows.filter(r => r.phone === filters.phone);
  }
  if (filters.status !== undefined) {
    rows = rows.filter(r => r.status === filters.status);
  }
  rows.sort((a, b) => b.id - a.id);
  return rows;
};

const findById = (id) => {
  return db.findById('members', id);
};

const findByPhone = (phone) => {
  return db.findOne('members', r => r.phone === phone);
};

const create = (data) => {
  const existing = findByPhone(data.phone);
  if (existing) {
    return existing;
  }
  const record = db.insert('members', {
    name: data.name,
    phone: data.phone,
    stored_value: data.stored_value !== undefined ? data.stored_value : 0,
    total_recharge: data.total_recharge !== undefined ? data.total_recharge : 0,
    total_consume: 0,
    status: data.status || 'active',
    remark: data.remark || null,
    level: data.level || '普通'
  });
  return record;
};

const update = (id, data) => {
  const fields = {};
  if (data.name !== undefined) fields.name = data.name;
  if (data.phone !== undefined) fields.phone = data.phone;
  if (data.stored_value !== undefined) fields.stored_value = data.stored_value;
  if (data.total_recharge !== undefined) fields.total_recharge = data.total_recharge;
  if (data.total_consume !== undefined) fields.total_consume = data.total_consume;
  if (data.status !== undefined) fields.status = data.status;
  if (data.remark !== undefined) fields.remark = data.remark;
  if (data.level !== undefined) fields.level = data.level;
  return db.update('members', id, fields);
};

const recharge = (phone, amount, operator = null) => {
  if (!amount || amount <= 0) {
    return { success: false, message: '充值金额必须大于0' };
  }
  let member = findByPhone(phone);
  if (!member) {
    member = create({ phone, name: phone, stored_value: 0 });
  }
  if (member.status !== 'active') {
    return { success: false, message: '该会员已停用' };
  }
  const updated = update(member.id, {
    stored_value: (member.stored_value || 0) + amount,
    total_recharge: (member.total_recharge || 0) + amount
  });
  transactionDao.create({
    customer_name: updated.name,
    customer_phone: updated.phone,
    transaction_date: new Date().toISOString().slice(0, 10),
    service_total: 0,
    addon_total: 0,
    total_amount: amount,
    actual_amount: amount,
    payment_method: 'cash',
    txn_type: 'recharge',
    remark: `储值充值 ¥${amount}`,
    status: 'completed'
  });
  return { success: true, data: updated, message: '充值成功' };
};

const consumeValue = (phone, amount, bookingId = null, remark = null) => {
  if (!amount || amount <= 0) {
    return { success: false, message: '扣款金额必须大于0' };
  }
  const member = findByPhone(phone);
  if (!member) {
    return { success: false, message: '会员不存在' };
  }
  if (member.status !== 'active') {
    return { success: false, message: '该会员已停用' };
  }
  if ((member.stored_value || 0) < amount) {
    return { success: false, message: `储值余额不足，当前余额 ¥${member.stored_value || 0}` };
  }
  const updated = update(member.id, {
    stored_value: (member.stored_value || 0) - amount,
    total_consume: (member.total_consume || 0) + amount
  });
  return { success: true, data: updated, message: '扣款成功' };
};

module.exports = {
  findAll,
  findById,
  findByPhone,
  create,
  update,
  recharge,
  consumeValue
};
