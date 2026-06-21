const db = require('../db');
const serviceDao = require('./serviceDao');
const memberDao = require('./memberDao');
const transactionDao = require('./transactionDao');

const enrich = (card) => {
  if (!card) return null;
  const svc = card.service_id ? serviceDao.findById(card.service_id) : null;
  return {
    ...card,
    service_name: svc ? svc.name : null,
    service_price: svc ? svc.price : 0
  };
};

const findAll = (filters = {}) => {
  let rows = db.findAll('member_cards');
  if (filters.phone !== undefined) {
    rows = rows.filter(r => r.customer_phone === filters.phone);
  }
  if (filters.service_id !== undefined) {
    rows = rows.filter(r => r.service_id === filters.service_id);
  }
  if (filters.status !== undefined) {
    rows = rows.filter(r => r.status === filters.status);
  }
  rows.sort((a, b) => b.id - a.id);
  return rows.map(enrich);
};

const findById = (id) => {
  return enrich(db.findById('member_cards', id));
};

const findAvailableByPhoneAndService = (phone, serviceId) => {
  return db.findMany('member_cards', r =>
    r.customer_phone === phone &&
    r.service_id === serviceId &&
    r.status === 'active' &&
    (r.remaining_count || 0) > 0
  ).sort((a, b) => {
    if (a.expire_date && b.expire_date) return a.expire_date.localeCompare(b.expire_date);
    if (a.expire_date) return -1;
    if (b.expire_date) return 1;
    return a.id - b.id;
  }).map(enrich);
};

const create = (data) => {
  const record = db.insert('member_cards', {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    service_id: data.service_id,
    total_count: data.total_count,
    remaining_count: data.remaining_count !== undefined ? data.remaining_count : data.total_count,
    used_count: 0,
    purchased_amount: data.purchased_amount || 0,
    purchase_date: data.purchase_date || new Date().toISOString().slice(0, 10),
    expire_date: data.expire_date || null,
    status: data.status || 'active',
    remark: data.remark || null
  });
  return findById(record.id);
};

const update = (id, data) => {
  const fields = {};
  if (data.customer_name !== undefined) fields.customer_name = data.customer_name;
  if (data.customer_phone !== undefined) fields.customer_phone = data.customer_phone;
  if (data.service_id !== undefined) fields.service_id = data.service_id;
  if (data.total_count !== undefined) fields.total_count = data.total_count;
  if (data.remaining_count !== undefined) fields.remaining_count = data.remaining_count;
  if (data.used_count !== undefined) fields.used_count = data.used_count;
  if (data.purchased_amount !== undefined) fields.purchased_amount = data.purchased_amount;
  if (data.expire_date !== undefined) fields.expire_date = data.expire_date;
  if (data.status !== undefined) fields.status = data.status;
  if (data.remark !== undefined) fields.remark = data.remark;
  return db.update('member_cards', id, fields);
};

const consumeCount = (phone, serviceId, count = 1, bookingId = null) => {
  const available = findAvailableByPhoneAndService(phone, serviceId);
  if (available.length === 0) {
    return { success: false, message: '该服务暂无可用次卡' };
  }
  const card = available[0];
  if (card.expire_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (card.expire_date < today) {
      return { success: false, message: `次卡已过期（到期日${card.expire_date}）` };
    }
  }
  if ((card.remaining_count || 0) < count) {
    return { success: false, message: `次卡剩余次数不足，剩${card.remaining_count}次` };
  }
  const updated = update(card.id, {
    remaining_count: (card.remaining_count || 0) - count,
    used_count: (card.used_count || 0) + count
  });
  return {
    success: true,
    data: enrich(updated),
    consumed: count,
    service_id: card.service_id,
    service_name: card.service_name,
    message: '次卡扣次成功'
  };
};

const purchase = (phone, name, serviceId, totalCount, paidAmount, expireDate = null, remark = null) => {
  if (!serviceDao.findById(serviceId)) {
    return { success: false, message: '服务项目不存在' };
  }
  const member = memberDao.findByPhone(phone);
  if (!member) {
    memberDao.create({ phone, name: name || phone });
  }
  const card = create({
    customer_name: name || phone,
    customer_phone: phone,
    service_id: serviceId,
    total_count: totalCount,
    purchased_amount: paidAmount,
    expire_date: expireDate,
    remark
  });
  if (paidAmount > 0) {
    transactionDao.create({
      customer_name: name || phone,
      customer_phone: phone,
      transaction_date: new Date().toISOString().slice(0, 10),
      service_total: paidAmount,
      addon_total: 0,
      total_amount: paidAmount,
      actual_amount: paidAmount,
      payment_method: 'cash',
      remark: `购买次卡${card.service_name || ''}×${totalCount}次`,
      status: 'completed'
    });
  }
  return { success: true, data: card, message: '次卡购买成功' };
};

module.exports = {
  findAll,
  findById,
  findAvailableByPhoneAndService,
  create,
  update,
  consumeCount,
  purchase
};
