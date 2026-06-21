const db = require('../db');
const employeeDao = require('./employeeDao');
const serviceDao = require('./serviceDao');
const bookingDao = require('./bookingDao');

const enrich = (w) => {
  if (!w) return null;
  const emp = w.employee_id ? employeeDao.findById(w.employee_id) : null;
  const svc = serviceDao.findById(w.service_id);

  let confirmedBooking = w.confirmed_booking_id ? bookingDao.findById(w.confirmed_booking_id) : null;
  if (!confirmedBooking && w.status === 'booked') {
    const candidates = bookingDao.findAll({
      customer_phone: w.customer_phone,
      booking_date: w.preferred_date
    });
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.id - a.id);
      confirmedBooking = candidates[0];
      if (confirmedBooking && !w.confirmed_booking_id) {
        db.update('waitlist', w.id, {
          confirmed_booking_id: confirmedBooking.id,
          confirmed_start_time: confirmedBooking.start_time,
          confirmed_employee_id: confirmedBooking.employee_id
        });
      }
    }
  }

  const confirmedEmp = confirmedBooking && confirmedBooking.employee_id
    ? employeeDao.findById(confirmedBooking.employee_id)
    : null;

  return {
    ...w,
    employee_name: emp ? emp.name : null,
    service_name: svc ? svc.name : null,
    duration_minutes: svc ? svc.duration_minutes : null,
    confirmed_booking: confirmedBooking ? {
      id: confirmedBooking.id,
      booking_no: confirmedBooking.booking_no,
      booking_date: confirmedBooking.booking_date,
      start_time: confirmedBooking.start_time,
      end_time: confirmedBooking.end_time,
      employee_id: confirmedBooking.employee_id,
      employee_name: confirmedEmp ? confirmedEmp.name : null,
      service_id: confirmedBooking.service_id,
      status: confirmedBooking.status,
      total_price: confirmedBooking.service_price || 0
    } : null,
    confirmed_booking_no: confirmedBooking ? confirmedBooking.booking_no : null,
    confirmed_booking_time: confirmedBooking ? confirmedBooking.start_time : null,
    confirmed_booking_stylist: confirmedEmp ? confirmedEmp.name : null
  };
};

const findAll = (filters = {}) => {
  let rows = db.findAll('waitlist');
  if (filters.preferred_date) {
    rows = rows.filter(r => r.preferred_date === filters.preferred_date);
  }
  if (filters.start_date && filters.end_date) {
    rows = rows.filter(r => r.preferred_date >= filters.start_date && r.preferred_date <= filters.end_date);
  }
  if (filters.status) {
    rows = rows.filter(r => r.status === filters.status);
  }
  if (filters.employee_id) {
    rows = rows.filter(r => r.employee_id === filters.employee_id);
  }
  rows.sort((a, b) => {
    const d = a.preferred_date.localeCompare(b.preferred_date);
    if (d !== 0) return d;
    return a.id - b.id;
  });
  return rows.map(enrich);
};

const findById = (id) => {
  return enrich(db.findById('waitlist', id));
};

const create = (data) => {
  const record = db.insert('waitlist', {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone,
    employee_id: data.employee_id || null,
    service_id: data.service_id,
    preferred_date: data.preferred_date,
    preferred_times: data.preferred_times || null,
    hair_note: data.hair_note || null,
    remark: data.remark || null,
    status: data.status || 'waiting',
    notified_at: null,
    confirmed_booking_id: null,
    confirmed_start_time: null,
    confirmed_employee_id: null
  });
  return findById(record.id);
};

const updateStatus = (id, status) => {
  const updates = { status };
  if (status === 'notified') {
    updates.notified_at = new Date().toISOString();
  }
  db.update('waitlist', id, updates);
  return findById(id);
};

const update = (id, data) => {
  const fields = {};
  if (data.customer_name !== undefined) fields.customer_name = data.customer_name;
  if (data.customer_phone !== undefined) fields.customer_phone = data.customer_phone;
  if (data.employee_id !== undefined) fields.employee_id = data.employee_id;
  if (data.service_id !== undefined) fields.service_id = data.service_id;
  if (data.preferred_date !== undefined) fields.preferred_date = data.preferred_date;
  if (data.preferred_times !== undefined) fields.preferred_times = data.preferred_times;
  if (data.hair_note !== undefined) fields.hair_note = data.hair_note;
  if (data.remark !== undefined) fields.remark = data.remark;
  if (data.status !== undefined) fields.status = data.status;
  if (data.confirmed_booking_id !== undefined) fields.confirmed_booking_id = data.confirmed_booking_id;
  if (data.confirmed_start_time !== undefined) fields.confirmed_start_time = data.confirmed_start_time;
  if (data.confirmed_employee_id !== undefined) fields.confirmed_employee_id = data.confirmed_employee_id;
  db.update('waitlist', id, fields);
  return findById(id);
};

const remove = (id) => {
  return db.remove('waitlist', id);
};

module.exports = {
  findAll,
  findById,
  create,
  updateStatus,
  update,
  remove
};
