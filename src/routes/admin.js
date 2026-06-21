const express = require('express');
const router = express.Router();
const bookingDao = require('../daos/bookingDao');
const scheduleDao = require('../daos/scheduleDao');
const employeeDao = require('../daos/employeeDao');
const serviceDao = require('../daos/serviceDao');
const configDao = require('../daos/configDao');
const { getDateStr, timeToMinutes, addMinutesToTime } = require('../utils/timeUtils');

router.get('/dashboard/:date', (req, res) => {
  const { date } = req.params;
  const targetDate = date || getDateStr();

  const allBookings = bookingDao.findAll({ booking_date: targetDate });
  const activeEmployees = employeeDao.findAll({ status: 'active' });
  const stylists = activeEmployees.filter(e => e.role === 'stylist');

  const schedules = scheduleDao.findByDateRange(targetDate, targetDate);
  const scheduleMap = {};
  for (const s of schedules) {
    scheduleMap[s.employee_id] = s;
  }

  const stations = [];
  for (const stylist of stylists) {
    const schedule = scheduleMap[stylist.id];
    const bookings = allBookings
      .filter(b => b.employee_id === stylist.id)
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    const arrivedCount = bookings.filter(b => b.status === 'arrived').length;
    const completedCount = bookings.filter(b => b.status === 'completed').length;
    const pendingCount = bookings.filter(b => ['pending', 'confirmed'].includes(b.status)).length;
    const cancelledCount = bookings.filter(b => b.status === 'cancelled').length;
    const noShowCount = bookings.filter(b => b.status === 'no_show').length;

    const revenue = bookings
      .filter(b => ['arrived', 'completed'].includes(b.status))
      .reduce((sum, b) => {
        let total = b.service_price || 0;
        if (b.addon_service_ids) {
          const addonIds = b.addon_service_ids.split(',').map(Number);
          const addons = serviceDao.findByIds(addonIds);
          total += addons.reduce((s, a) => s + a.price, 0);
        }
        return sum + total;
      }, 0);

    stations.push({
      employee_id: stylist.id,
      employee_name: stylist.name,
      station_number: stylist.station_number,
      schedule: schedule || null,
      is_day_off: schedule ? schedule.is_day_off : true,
      bookings,
      stats: {
        total: bookings.length,
        pending: pendingCount,
        arrived: arrivedCount,
        completed: completedCount,
        cancelled: cancelledCount,
        no_show: noShowCount,
        revenue
      }
    });
  }

  const unconfirmedBookings = allBookings.filter(b => b.status === 'pending');

  const totalExpectedRevenue = allBookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
    .reduce((sum, b) => {
      let total = b.service_price || 0;
      if (b.addon_service_ids) {
        const addonIds = b.addon_service_ids.split(',').map(Number);
        const addons = serviceDao.findByIds(addonIds);
        total += addons.reduce((s, a) => s + a.price, 0);
      }
      return sum + total;
    }, 0);

  const actualRevenue = allBookings
    .filter(b => ['arrived', 'completed'].includes(b.status))
    .reduce((sum, b) => {
      let total = b.service_price || 0;
      if (b.addon_service_ids) {
        const addonIds = b.addon_service_ids.split(',').map(Number);
        const addons = serviceDao.findByIds(addonIds);
        total += addons.reduce((s, a) => s + a.price, 0);
      }
      return sum + total;
    }, 0);

  const businessStart = configDao.getConfig('business_start');
  const businessEnd = configDao.getConfig('business_end');
  const totalMinutes = timeToMinutes(businessEnd) - timeToMinutes(businessStart);
  const totalWorkingMinutes = stations
    .filter(s => !s.is_day_off)
    .reduce((sum, s) => {
      if (!s.schedule) return sum;
      return sum + (timeToMinutes(s.schedule.end_time) - timeToMinutes(s.schedule.start_time));
    }, 0);

  const occupiedMinutes = allBookings
    .filter(b => b.status !== 'cancelled' && b.status !== 'no_show')
    .reduce((sum, b) => {
      return sum + (timeToMinutes(b.end_time) - timeToMinutes(b.start_time));
    }, 0);

  const occupancyRate = totalWorkingMinutes > 0
    ? Math.round((occupiedMinutes / totalWorkingMinutes) * 10000) / 100
    : 0;

  res.json({
    code: 0,
    data: {
      date: targetDate,
      summary: {
        total_bookings: allBookings.length,
        unconfirmed_count: unconfirmedBookings.length,
        no_show_count: allBookings.filter(b => b.status === 'no_show').length,
        cancelled_count: allBookings.filter(b => b.status === 'cancelled').length,
        completed_count: allBookings.filter(b => b.status === 'completed').length,
        arrived_count: allBookings.filter(b => b.status === 'arrived').length,
        expected_revenue: totalExpectedRevenue,
        actual_revenue: actualRevenue,
        occupancy_rate: occupancyRate,
        working_stylists: stations.filter(s => !s.is_day_off).length
      },
      stations,
      unconfirmed_bookings: unconfirmedBookings
    }
  });
});

router.get('/revenue', (req, res) => {
  let { start_date, end_date } = req.query;
  if (!start_date) start_date = getDateStr();
  if (!end_date) end_date = start_date;

  const bookings = bookingDao.findAll({
    start_date,
    end_date,
    status: ['arrived', 'completed']
  });

  const dailyStats = {};
  const stylistStats = {};

  for (const b of bookings) {
    let total = b.service_price || 0;
    if (b.addon_service_ids) {
      const addonIds = b.addon_service_ids.split(',').map(Number);
      const addons = serviceDao.findByIds(addonIds);
      total += addons.reduce((s, a) => s + a.price, 0);
    }

    if (!dailyStats[b.booking_date]) {
      dailyStats[b.booking_date] = { date: b.booking_date, revenue: 0, count: 0 };
    }
    dailyStats[b.booking_date].revenue += total;
    dailyStats[b.booking_date].count += 1;

    if (!stylistStats[b.employee_id]) {
      stylistStats[b.employee_id] = {
        employee_id: b.employee_id,
        employee_name: b.employee_name,
        revenue: 0,
        count: 0
      };
    }
    stylistStats[b.employee_id].revenue += total;
    stylistStats[b.employee_id].count += 1;
  }

  const totalRevenue = Object.values(dailyStats).reduce((s, d) => s + d.revenue, 0);
  const totalCount = Object.values(dailyStats).reduce((s, d) => s + d.count, 0);

  res.json({
    code: 0,
    data: {
      start_date,
      end_date,
      total_revenue: totalRevenue,
      total_count: totalCount,
      avg_per_booking: totalCount > 0 ? Math.round((totalRevenue / totalCount) * 100) / 100 : 0,
      daily: Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date)),
      by_stylist: Object.values(stylistStats).sort((a, b) => b.revenue - a.revenue)
    }
  });
});

router.get('/station-occupancy/:date', (req, res) => {
  const { date } = req.params;
  const targetDate = date || getDateStr();
  const interval = 30;

  const businessStart = configDao.getConfig('business_start');
  const businessEnd = configDao.getConfig('business_end');

  const timeSlots = [];
  let current = businessStart;
  while (timeToMinutes(current) < timeToMinutes(businessEnd)) {
    timeSlots.push(current);
    current = addMinutesToTime(current, interval);
  }

  const stylists = employeeDao.findAll({ role: 'stylist', status: 'active' });
  const schedules = scheduleDao.findByDateRange(targetDate, targetDate);
  const scheduleMap = {};
  for (const s of schedules) scheduleMap[s.employee_id] = s;

  const bookings = bookingDao.findAll({ booking_date: targetDate });

  const result = {
    date: targetDate,
    time_slots: timeSlots,
    stations: []
  };

  for (const stylist of stylists) {
    const schedule = scheduleMap[stylist.id];
    const stationBookings = bookings.filter(b => b.employee_id === stylist.id);

    const slotStatus = {};
    for (const slot of timeSlots) {
      slotStatus[slot] = schedule && !schedule.is_day_off ? 'off' : 'off';

      if (schedule && !schedule.is_day_off) {
        const slotStart = timeToMinutes(slot);
        const slotEnd = slotStart + interval;
        const workStart = timeToMinutes(schedule.start_time);
        const workEnd = timeToMinutes(schedule.end_time);

        if (slotStart >= workStart && slotEnd <= workEnd) {
          let inBreak = false;
          if (schedule.break_start && schedule.break_end) {
            const bStart = timeToMinutes(schedule.break_start);
            const bEnd = timeToMinutes(schedule.break_end);
            if (slotStart >= bStart && slotEnd <= bEnd) inBreak = true;
          }
          if (inBreak) {
            slotStatus[slot] = 'break';
          } else {
            slotStatus[slot] = 'free';
            for (const b of stationBookings) {
              if (b.status === 'cancelled' || b.status === 'no_show') continue;
              const bStart = timeToMinutes(b.start_time);
              const bEnd = timeToMinutes(b.end_time);
              if (slotStart < bEnd && slotEnd > bStart) {
                slotStatus[slot] = b.status;
                break;
              }
            }
          }
        }
      }
    }

    result.stations.push({
      employee_id: stylist.id,
      employee_name: stylist.name,
      station_number: stylist.station_number,
      is_day_off: schedule ? schedule.is_day_off : true,
      schedule: schedule || null,
      slot_status: slotStatus,
      bookings: stationBookings
    });
  }

  res.json({ code: 0, data: result });
});

module.exports = router;
