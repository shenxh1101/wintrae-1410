const db = require('../db');
const { timeToMinutes, doRangesOverlap } = require('../utils/timeUtils');
const employeeDao = require('./employeeDao');
const serviceDao = require('./serviceDao');

const enrich = (b) => {
  if (!b) return null;
  const emp = employeeDao.findById(b.employee_id);
  const asst = b.assistant_id ? employeeDao.findById(b.assistant_id) : null;
  const svc = serviceDao.findById(b.service_id);
  return {
    ...b,
    employee_name: emp ? emp.name : null,
    assistant_name: asst ? asst.name : null,
    service_name: svc ? svc.name : null,
    service_duration: svc ? svc.duration_minutes : null,
    service_price: svc ? svc.price : 0
  };
};

const findAll = (filters = {}) => {
  let rows = db.findAll('bookings');

  if (filters.booking_date) {
    rows = rows.filter(r => r.booking_date === filters.booking_date);
  }
  if (filters.start_date && filters.end_date) {
    rows = rows.filter(r => r.booking_date >= filters.start_date && r.booking_date <= filters.end_date);
  }
  if (filters.employee_id) {
    rows = rows.filter(r => r.employee_id === filters.employee_id);
  }
  if (filters.customer_phone) {
    rows = rows.filter(r => r.customer_phone === filters.customer_phone);
  }
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    rows = rows.filter(r => statuses.includes(r.status));
  }
  if (filters.is_no_show !== undefined) {
    rows = rows.filter(r => (r.is_no_show || 0) === filters.is_no_show);
  }

  rows.sort((a, b) => {
    const d = b.booking_date.localeCompare(a.booking_date);
    if (d !== 0) return d;
    return timeToMinutes(b.start_time) - timeToMinutes(a.start_time);
  });

  return rows.map(enrich);
};

const findById = (id) => {
  return enrich(db.findById('bookings', id));
};

const findByBookingNo = (bookingNo) => {
  return enrich(db.findOne('bookings', r => r.booking_no === bookingNo));
};

const findOverlapping = (employeeId, date, startTime, endTime, excludeBookingId = null) => {
  return db.findMany('bookings', r => {
    if (r.employee_id !== employeeId) return false;
    if (r.booking_date !== date) return false;
    if (r.status === 'cancelled' || r.status === 'no_show') return false;
    if (excludeBookingId && r.id === excludeBookingId) return false;
    return doRangesOverlap(r.start_time, r.end_time, startTime, endTime);
  });
};

const findCustomerSameDate = (customerPhone, date, excludeBookingId = null) => {
  return db.findMany('bookings', r => {
    if (r.customer_phone !== customerPhone) return false;
    if (r.booking_date !== date) return false;
    if (r.status === 'cancelled' || r.status === 'no_show') return false;
    if (excludeBookingId && r.id === excludeBookingId) return false;
    return true;
  });
};

const generateBookingNo = () => {
  const prefix = 'BK' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const count = db.findAll('bookings').filter(r => r.booking_no && r.booking_no.startsWith(prefix)).length;
  const seq = String(count + 1).padStart(4, '0');
  return prefix + seq;
};

const create = (data) => {
  const bookingNo = data.booking_no || generateBookingNo();
  const record = db.insert('bookings', {
    booking_no: bookingNo,
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    employee_id: data.employee_id,
    assistant_id: data.assistant_id || null,
    service_id: data.service_id,
    addon_service_ids: data.addon_service_ids || null,
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    hair_note: data.hair_note || null,
    remark: data.remark || null,
    status: data.status || 'pending',
    is_no_show: 0,
    arrived_at: null,
    completed_at: null,
    source: data.source || 'online'
  });
  return findById(record.id);
};

const update = (id, data) => {
  db.update('bookings', id, {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    employee_id: data.employee_id,
    assistant_id: data.assistant_id || null,
    service_id: data.service_id,
    addon_service_ids: data.addon_service_ids || null,
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    hair_note: data.hair_note || null,
    remark: data.remark || null,
    status: data.status
  });
  return findById(id);
};

const updateStatus = (id, status) => {
  const updates = { status };
  if (status === 'arrived') {
    updates.arrived_at = new Date().toISOString();
  } else if (status === 'completed') {
    updates.completed_at = new Date().toISOString();
  } else if (status === 'no_show') {
    updates.is_no_show = 1;
  }
  db.update('bookings', id, updates);
  return findById(id);
};

const markNoShow = (id) => {
  return updateStatus(id, 'no_show');
};

module.exports = {
  findAll,
  findById,
  findByBookingNo,
  findOverlapping,
  findCustomerSameDate,
  create,
  update,
  updateStatus,
  markNoShow
};
