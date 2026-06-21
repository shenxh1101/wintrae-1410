const db = require('../db');
const serviceDao = require('./serviceDao');
const employeeDao = require('./employeeDao');

const enrich = (t) => {
  if (!t) return null;
  const emp = t.employee_id ? employeeDao.findById(t.employee_id) : null;
  return {
    ...t,
    employee_name: emp ? emp.name : null
  };
};

const findAll = (filters = {}) => {
  let rows = db.findAll('transactions');
  if (filters.booking_id !== undefined) {
    rows = rows.filter(r => r.booking_id === filters.booking_id);
  }
  if (filters.customer_phone !== undefined) {
    rows = rows.filter(r => r.customer_phone === filters.customer_phone);
  }
  if (filters.start_date && filters.end_date) {
    rows = rows.filter(r => r.transaction_date >= filters.start_date && r.transaction_date <= filters.end_date);
  }
  if (filters.payment_method !== undefined) {
    rows = rows.filter(r => r.payment_method === filters.payment_method);
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

module.exports = {
  findAll,
  findById,
  findByBookingId,
  create,
  remove,
  getRevenueByMethod
};
