const db = require('../db');
const serviceDao = require('./serviceDao');
const employeeDao = require('./employeeDao');

const enrich = (t) => {
  if (!t) return null;
  const emp = t.employee_id ? employeeDao.findById(t.employee_id) : null;
  const svcList = [];
  if (t.service_total) svcList.push(`主服务¥${t.service_total}`);
  if (t.addon_total) svcList.push(`加做¥${t.addon_total}`);
  const txnType = t.txn_type || guessType(t);
  return {
    ...t,
    txn_type: txnType,
    type_label: typeLabel(txnType),
    employee_name: emp ? emp.name : null,
    service_summary: svcList.join(' + ') || null
  };
};

const guessType = (t) => {
  if (t.booking_id) return 'consumption';
  if (t.remark && t.remark.indexOf('储值充值') >= 0) return 'recharge';
  if (t.remark && t.remark.indexOf('购买次卡') >= 0) return 'card_purchase';
  if ((t.stored_value_used || 0) > 0 || (t.service_card_used_count || 0) > 0) return 'consumption';
  return 'consumption';
};

const typeLabel = (type) => ({
  recharge: '储值充值',
  card_purchase: '次卡售卖',
  consumption: '到店消费',
  refund: '退款'
}[type] || '到店消费');

const findAll = (filters = {}) => {
  let rows = db.findAll('transactions');
  if (filters.booking_id !== undefined) {
    rows = rows.filter(r => r.booking_id === filters.booking_id);
  }
  if (filters.customer_phone !== undefined) {
    rows = rows.filter(r => r.customer_phone === filters.customer_phone);
  }
  if (filters.start_date) {
    rows = rows.filter(r => r.transaction_date >= filters.start_date);
  }
  if (filters.end_date) {
    rows = rows.filter(r => r.transaction_date <= filters.end_date);
  }
  if (filters.payment_method !== undefined) {
    rows = rows.filter(r => r.payment_method === filters.payment_method);
  }
  if (filters.txn_type !== undefined) {
    rows = rows.filter(r => (r.txn_type || guessType(r)) === filters.txn_type);
  }
  rows.sort((a, b) => {
    const d = b.transaction_date.localeCompare(a.transaction_date);
    if (d !== 0) return d;
    return b.id - a.id;
  });
  return rows.map(enrich);
};

const findById = (id) => {
  return enrich(db.findById('transactions', id));
};

const findByBookingId = (bookingId) => {
  const rows = db.findMany('transactions', r => r.booking_id === bookingId);
  return rows.sort((a, b) => b.id - a.id).map(enrich);
};

const generateTxnNo = () => {
  const prefix = 'TXN' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = db.findAll('transactions').filter(r => r.transaction_no && r.transaction_no.startsWith(prefix)).length;
  const seq = String(count + 1).padStart(4, '0');
  return prefix + seq;
};

const create = (data) => {
  const txnNo = data.transaction_no || generateTxnNo();
  const record = db.insert('transactions', {
    transaction_no: txnNo,
    booking_id: data.booking_id || null,
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    employee_id: data.employee_id || null,
    transaction_date: data.transaction_date || new Date().toISOString().slice(0, 10),
    service_total: data.service_total || 0,
    addon_total: data.addon_total || 0,
    discount_amount: data.discount_amount || 0,
    deposit_used: data.deposit_used || 0,
    stored_value_used: data.stored_value_used || 0,
    service_card_used_count: data.service_card_used_count || 0,
    service_card_used_detail: data.service_card_used_detail || null,
    total_amount: data.total_amount || 0,
    actual_amount: data.actual_amount || 0,
    payment_method: data.payment_method || 'cash',
    payment_detail: data.payment_detail || null,
    remark: data.remark || null,
    txn_type: data.txn_type || (data.booking_id ? 'consumption' : 'other'),
    status: data.status || 'completed'
  });
  return findById(record.id);
};

const remove = (id) => {
  return db.remove('transactions', id);
};

const getRevenueByMethod = (startDate, endDate) => {
  const txns = db.findMany('transactions', r =>
    r.transaction_date >= startDate && r.transaction_date <= endDate && r.status === 'completed'
  );
  const byMethod = {};
  let totalAmount = 0;
  let totalCount = 0;
  for (const t of txns) {
    const method = t.payment_method || 'unknown';
    if (!byMethod[method]) {
      byMethod[method] = { payment_method: method, total_amount: 0, count: 0 };
    }
    byMethod[method].total_amount += t.actual_amount || 0;
    byMethod[method].count += 1;
    totalAmount += t.actual_amount || 0;
    totalCount += 1;
  }
  return {
    start_date: startDate,
    end_date: endDate,
    total_amount: totalAmount,
    total_count: totalCount,
    by_method: Object.values(byMethod).sort((a, b) => b.total_amount - a.total_amount)
  };
};

const getFinanceBreakdown = (startDate, endDate) => {
  const txns = db.findMany('transactions', r =>
    r.transaction_date >= startDate && r.transaction_date <= endDate && r.status === 'completed'
  );
  const buckets = {
    recharge: { label: '储值充值', total_amount: 0, count: 0 },
    card_purchase: { label: '次卡售卖', total_amount: 0, count: 0 },
    consumption: { label: '到店消费', total_amount: 0, count: 0, cash_amount: 0, stored_value_amount: 0, deposit_amount: 0, service_card_count: 0 },
    other: { label: '其他', total_amount: 0, count: 0 }
  };
  let total_amount = 0, total_count = 0;
  for (const t of txns) {
    const type = t.txn_type || guessType(t);
    const bucket = buckets[type] || buckets.other;
    bucket.total_amount += t.actual_amount || 0;
    bucket.count += 1;
    total_amount += t.actual_amount || 0;
    total_count += 1;
    if (type === 'consumption') {
      buckets.consumption.cash_amount +=
        (['cash', 'wechat', 'alipay', 'card'].includes(t.payment_method) ? (t.actual_amount || 0) : 0);
      buckets.consumption.stored_value_amount += t.stored_value_used || 0;
      buckets.consumption.deposit_amount += t.deposit_used || 0;
      buckets.consumption.service_card_count += t.service_card_used_count || 0;
    }
  }
  return {
    start_date: startDate,
    end_date: endDate,
    total_amount,
    total_count,
    recharge: buckets.recharge,
    card_purchase: buckets.card_purchase,
    consumption: buckets.consumption,
    other: buckets.other
  };
};

module.exports = {
  findAll,
  findById,
  findByBookingId,
  create,
  remove,
  getRevenueByMethod,
  getFinanceBreakdown,
  guessType,
  typeLabel
};
