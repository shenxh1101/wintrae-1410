const db = require('../db');
const serviceDao = require('./serviceDao');
const employeeDao = require('./employeeDao');

const getCustomerProfile = (phone) => {
  if (!phone) return null;

  const allBookings = db.findMany('bookings', r => r.customer_phone === phone);

  const noShowCount = allBookings.filter(b => b.status === 'no_show' || b.is_no_show === 1).length;
  const totalCount = allBookings.length;
  const cancelledCount = allBookings.filter(b => b.status === 'cancelled').length;
  const completedCount = allBookings.filter(b => b.status === 'completed' || b.status === 'arrived').length;

  const stylistCounts = {};
  const serviceCounts = {};
  let totalSpent = 0;
  const hairNotes = [];
  let lastArrivalDate = null;
  let lastNoShowBooking = null;
  const recentConsumptions = [];

  for (const b of allBookings) {
    const mainService = serviceDao.findById(b.service_id);
    let amount = mainService ? mainService.price : 0;
    if (b.addon_service_ids) {
      const addonIds = b.addon_service_ids.split(',').map(Number);
      const addons = serviceDao.findByIds(addonIds);
      amount += addons.reduce((s, a) => s + a.price, 0);
    }

    if (b.status === 'completed' || b.status === 'arrived') {
      totalSpent += amount;
      if (!lastArrivalDate || b.booking_date > lastArrivalDate) {
        lastArrivalDate = b.booking_date;
      }
      recentConsumptions.push({
        id: b.id,
        booking_date: b.booking_date,
        start_time: b.start_time,
        service_name: mainService ? mainService.name : null,
        service_price: mainService ? mainService.price : 0,
        amount,
        status: b.status,
        hair_note: b.hair_note || null
      });
    }

    if (b.status === 'no_show' || b.is_no_show === 1) {
      if (!lastNoShowBooking || b.booking_date > lastNoShowBooking.booking_date) {
        lastNoShowBooking = {
          id: b.id,
          booking_date: b.booking_date,
          start_time: b.start_time,
          service_name: mainService ? mainService.name : null,
          no_show_reason: b.no_show_reason || null
        };
      }
    }

    if (b.employee_id) {
      stylistCounts[b.employee_id] = (stylistCounts[b.employee_id] || 0) + 1;
    }
    if (b.service_id) {
      serviceCounts[b.service_id] = (serviceCounts[b.service_id] || 0) + 1;
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
    employee_name: employeeDao.findById(sortedStylists[0].employee_id)?.name,
    visit_count: sortedStylists[0].count,
    ratio: totalCount > 0 ? Math.round((sortedStylists[0].count / totalCount) * 100) : 0
  } : null;

  const sortedServices = Object.entries(serviceCounts)
    .map(([id, count]) => ({ service_id: parseInt(id), count }))
    .sort((a, b) => b.count - a.count);

  const topServices = sortedServices.slice(0, 3).map(s => {
    const svc = serviceDao.findById(s.service_id);
    return {
      service_id: s.service_id,
      service_name: svc ? svc.name : null,
      count: s.count,
      ratio: totalCount > 0 ? Math.round((s.count / totalCount) * 100) : 0
    };
  });

  const recentBookings = allBookings
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map(b => {
      const mainService = serviceDao.findById(b.service_id);
      let amount = mainService ? mainService.price : 0;
      if (b.addon_service_ids) {
        const addonIds = b.addon_service_ids.split(',').map(Number);
        const addons = serviceDao.findByIds(addonIds);
        amount += addons.reduce((s, a) => s + a.price, 0);
      }
      return {
        id: b.id,
        booking_no: b.booking_no,
        booking_date: b.booking_date,
        start_time: b.start_time,
        end_time: b.end_time,
        service_name: mainService ? mainService.name : null,
        amount,
        status: b.status,
        is_no_show: b.is_no_show || 0
      };
    });

  recentConsumptions.sort((a, b) => b.booking_date.localeCompare(a.booking_date));
  const top5Consumptions = recentConsumptions.slice(0, 5);

  const sortedAllBookings = [...allBookings].sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
  const firstBookingDate = sortedAllBookings.length > 0
    ? sortedAllBookings[sortedAllBookings.length - 1].booking_date
    : null;
  const lastBookingDate = sortedAllBookings.length > 0
    ? sortedAllBookings[0].booking_date
    : null;

  return {
    customer_phone: phone,
    total_bookings: totalCount,
    completed_bookings: completedCount,
    cancelled_bookings: cancelledCount,
    no_show_count: noShowCount,
    total_spent: totalSpent,
    avg_spent: completedCount > 0 ? Math.round((totalSpent / completedCount) * 100) / 100 : 0,
    preferred_stylist: preferredStylist,
    top_services: topServices,
    hair_notes: hairNotes,
    last_arrival_date: lastArrivalDate,
    last_no_show: lastNoShowBooking,
    recent_consumptions: top5Consumptions,
    recent_bookings: recentBookings,
    first_booking_date: firstBookingDate,
    last_booking_date: lastBookingDate
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
