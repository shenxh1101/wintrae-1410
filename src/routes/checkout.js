const express = require('express');
const router = express.Router();
const bookingDao = require('../daos/bookingDao');
const transactionDao = require('../daos/transactionDao');
const memberDao = require('../daos/memberDao');
const memberCardDao = require('../daos/memberCardDao');
const serviceDao = require('../daos/serviceDao');

router.post('/:bookingId/checkout', (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const booking = bookingDao.findById(bookingId);
  if (!booking) {
    return res.status(404).json({ code: 1, message: '预约不存在' });
  }
  if (booking.status === 'completed') {
    const txns = transactionDao.findByBookingId(bookingId);
    return res.json({
      code: 0,
      data: booking,
      transactions: txns,
      is_duplicate: true,
      message: '该预约已完成结账'
    });
  }
  if (booking.status !== 'arrived' && booking.status !== 'confirmed') {
    return res.status(400).json({
      code: 1,
      message: `预约状态(${booking.status})无法结账，需先标记到店`
    });
  }

  const {
    discount_amount = 0,
    use_deposit = true,
    use_stored_value = 0,
    use_service_cards = [],
    payment_method = 'cash',
    payment_detail = null,
    remark = null
  } = req.body;

  const mainService = serviceDao.findById(booking.service_id);
  const addonIds = booking.addon_service_ids
    ? booking.addon_service_ids.split(',').map(Number)
    : [];
  const addonServices = addonIds.length ? serviceDao.findByIds(addonIds) : [];
  const serviceTotal = mainService ? mainService.price : 0;
  const addonTotal = addonServices.reduce((s, a) => s + a.price, 0);

  let depositUsed = 0;
  if (use_deposit && booking.deposit_amount > 0 && booking.deposit_status === 'paid') {
    depositUsed = booking.deposit_amount;
  }

  let storedValueUsed = 0;
  if (use_stored_value > 0) {
    storedValueUsed = Math.min(use_stored_value, serviceTotal + addonTotal);
  }

  const cardUsedDetail = [];
  let cardUsedCount = 0;
  const remainingByService = {};

  for (const cardUse of use_service_cards || []) {
    const svcId = parseInt(cardUse.service_id);
    const count = parseInt(cardUse.count) || 1;
    if (!remainingByService[svcId]) {
      remainingByService[svcId] = [];
      if (svcId === booking.service_id) {
        remainingByService[svcId].push({ is_main: true, price: mainService ? mainService.price : 0 });
      }
      for (const add of addonServices) {
        if (add.id === svcId) {
          remainingByService[svcId].push({ is_main: false, price: add.price, addon_id: add.id });
        }
      }
    }
    const available = remainingByService[svcId];
    for (let i = 0; i < count && available.length > 0; i++) {
      available.shift();
      cardUsedCount += 1;
      cardUsedDetail.push({
        service_id: svcId,
        count: 1
      });
    }
  }

  const svcPriceFromCards = cardUsedDetail.reduce((s, c) => {
    if (c.service_id === booking.service_id) {
      return s + (mainService ? mainService.price : 0);
    }
    const addon = addonServices.find(a => a.id === c.service_id);
    return s + (addon ? addon.price : 0);
  }, 0);

  const totalAmount = serviceTotal + addonTotal;
  const actualAmount = Math.max(
    0,
    totalAmount -
      Math.min(discount_amount, totalAmount) -
      depositUsed -
      storedValueUsed -
      svcPriceFromCards
  );

  if (actualAmount > 0 && payment_method === 'stored_value') {
    const member = memberDao.findByPhone(booking.customer_phone);
    if (!member || (member.stored_value || 0) < actualAmount + storedValueUsed) {
      return res.status(400).json({
        code: 1,
        message: `储值余额不足，当前余额¥${member ? member.stored_value || 0 : 0}`
      });
    }
  }

  const totalFromCards = cardUsedCount > 0;
  const allPaid = actualAmount <= 0 ||
    payment_method === 'cash' ||
    payment_method === 'wechat' ||
    payment_method === 'alipay' ||
    payment_method === 'card' ||
    payment_method === 'stored_value';

  if (use_stored_value > 0) {
    const consume = memberDao.consumeValue(
      booking.customer_phone,
      storedValueUsed,
      bookingId,
      '预约消费扣储值'
    );
    if (!consume.success) {
      return res.status(400).json({ code: 1, message: consume.message });
    }
  }

  if (actualAmount > 0 && payment_method === 'stored_value') {
    const consume = memberDao.consumeValue(
      booking.customer_phone,
      actualAmount,
      bookingId,
      '预约消费扣储值'
    );
    if (!consume.success) {
      return res.status(400).json({ code: 1, message: consume.message });
    }
  }

  if (cardUsedCount > 0) {
    const bySvc = {};
    for (const c of cardUsedDetail) {
      bySvc[c.service_id] = (bySvc[c.service_id] || 0) + c.count;
    }
    for (const [svcIdStr, cnt] of Object.entries(bySvc)) {
      const consume = memberCardDao.consumeCount(
        booking.customer_phone,
        parseInt(svcIdStr),
        cnt,
        bookingId
      );
      if (!consume.success) {
        return res.status(400).json({ code: 1, message: consume.message });
      }
    }
  }

  if (depositUsed > 0) {
    bookingDao.useDeposit(bookingId, remark);
  }

  bookingDao.updateStatus(bookingId, 'completed');
  bookingDao.update(bookingId, { remark: remark || booking.remark });

  const txn = transactionDao.create({
    booking_id: bookingId,
    customer_name: booking.customer_name,
    customer_phone: booking.customer_phone,
    employee_id: booking.employee_id,
    transaction_date: new Date().toISOString().slice(0, 10),
    service_total: serviceTotal,
    addon_total: addonTotal,
    discount_amount: Math.min(discount_amount, totalAmount),
    deposit_used: depositUsed,
    stored_value_used: storedValueUsed + (payment_method === 'stored_value' ? actualAmount : 0),
    service_card_used_count: cardUsedCount,
    service_card_used_detail: cardUsedDetail.length ? JSON.stringify(cardUsedDetail) : null,
    total_amount: totalAmount,
    actual_amount: actualAmount,
    payment_method: cardUsedCount > 0 && actualAmount === 0 ? 'service_card' : payment_method,
    payment_detail,
    remark
  });

  const memberAfter = memberDao.findByPhone(booking.customer_phone);
  const cardsAfter = memberCardDao.findAll({ phone: booking.customer_phone, status: 'active' });

  res.json({
    code: 0,
    data: {
      booking: bookingDao.findById(bookingId),
      transaction: txn
    },
    summary: {
      service_total: serviceTotal,
      addon_total: addonTotal,
      total_amount: totalAmount,
      discount_amount: Math.min(discount_amount, totalAmount),
      deposit_used: depositUsed,
      stored_value_used: storedValueUsed + (payment_method === 'stored_value' ? actualAmount : 0),
      service_card_used_count: cardUsedCount,
      actual_amount: actualAmount,
      payment_method: txn.payment_method
    },
    member_remaining: {
      stored_value: memberAfter ? memberAfter.stored_value || 0 : 0,
      cards: cardsAfter
    },
    message: '结账成功'
  });
});

router.get('/booking/:bookingId', (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const txns = transactionDao.findByBookingId(bookingId);
  res.json({ code: 0, data: txns });
});

module.exports = router;
