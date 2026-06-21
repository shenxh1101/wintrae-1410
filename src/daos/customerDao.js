const db = require('../db');
const serviceDao = require('./serviceDao');

const getCustomerProfile = (phone) => {
  if (!phone) return null;

  const allBookings = db.findMany('bookings', r => r.customer_phone === phone);

  const noShowCount = allBookings.filter(b => b.status === 'no_show' || b.is_no_show === 1).length;
  const totalCount = allBookings.length;
  const cancelledCount = allBookings.filter(b => b.status === 'cancelled').length;
  const completedCount = allBookings.filter(b => b.status === 'completed' || b.status === 'arrived').length;

  const stylistCounts = {};
  let totalSpent = 0;
  const hairNotes = [];

  for (const b of allBookings) {
    if (b.status === 'completed' || b.status === 'arrived') {
      const mainService = serviceDao.findById(b.service_id);
      let amount = mainService ? mainService.price : 0;
      if (b.addon_service_ids) {
        const addonIds = b.addon_service_ids.split(',').map(Number);
        const addons = serviceDao.findByIds(addonIds);
        amount += addons.reduce((s, a) => s + a.price, 0);
      }
      totalSpent += amount;
    }

    if (b.employee_id) {
      stylistCounts[b.employee_id] = (stylistCounts[b.employee_id] || 0) + 1;
    }
    if (b.hair_note && hairNotes.indexOf(b.hair_note) === -1) {
      hairNotes.push(b.hair_note);
    }
  }

  const sortedStylists = Object.entries(stylistCounts)
    .map(([id, count]) => ({ employee_id: parseInt(id), count }))
    .sort((a, b) => b.count - a.count);

  const preferredStylist = sortedStylists[0] ? {
    employee_id: sortedStylists[0].employee_id,
    visit_count: sortedStylists[0].count,
    ratio: totalCount > 0 ? Math.round((sortedStylists[0].count / totalCount) * 100) : 0
  } : null;

  const recentBookings = allBookings
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map(b => {
      const mainService = serviceDao.findById(b.service_id);
      return {
        id: b.id,
        booking_no: b.booking_no,
        booking_date: b.booking_date,
        start_time: b.start_time,
        end_time: b.end_time,
        service_name: mainService ? mainService.name : null,
        status: b.status,
        is_no_show: b.is_no_show || 0
      };
    });

  return {
    customer_phone: phone,
    total_bookings: totalCount,
    completed_bookings: completedCount,
    cancelled_bookings: cancelledCount,
    no_show_count: noShowCount,
    total_spent: totalSpent,
    avg_spent: completedCount > 0 ? Math.round((totalSpent / completedCount) * 100) / 100 : 0,
    preferred_stylist: preferredStylist,
    hair_notes: hairNotes,
    recent_bookings: recentBookings,
    first_booking_date: allBookings.length > 0 ? allBookings.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0].booking_date : null,
    last_booking_date: allBookings.length > 0 ? allBookings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].booking_date : null
  };
};

const getNoShowCount = (phone) => {
  if (!phone) return 0;
  return db.findMany('bookings', r =>
    r.customer_phone === phone && (r.status === 'no_show' || r.is_no_show === 1)
  ).length;
};

module.exports = {
  getCustomerProfile,
  getNoShowCount
};
