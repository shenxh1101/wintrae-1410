const express = require('express');
const router = express.Router();
const customerDao = require('../daos/customerDao');
const bookingDao = require('../daos/bookingDao');

router.get('/profile/:phone', (req, res) => {
  const { phone } = req.params;
  if (!phone) {
    return res.status(400).json({ code: 1, message: '手机号必填' });
  }
  const profile = customerDao.getCustomerProfile(phone);
  res.json({ code: 0, data: profile });
});

router.get('/bookings/:phone', (req, res) => {
  const { phone } = req.params;
  const { status, start_date, end_date, limit } = req.query;
  if (!phone) {
    return res.status(400).json({ code: 1, message: '手机号必填' });
  }
  const filters = { customer_phone: phone };
  if (status) filters.status = status.includes(',') ? status.split(',') : status;
  if (start_date && end_date) {
    filters.start_date = start_date;
    filters.end_date = end_date;
  }
  let bookings = bookingDao.findAll(filters);
  if (limit) {
    bookings = bookings.slice(0, parseInt(limit));
  }
  res.json({ code: 0, data: bookings });
});

module.exports = router;
