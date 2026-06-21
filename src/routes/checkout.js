const express = require('express');
const router = express.Router();
const db = require('../db');
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

  const parsedDiscount = parseFloat(discount_amount) || 0;
  const parsedStoredValue = parseFloat(use_stored_value) || 0;

  const mainService = serviceDao.findById(booking.service_id);
  const addonIds = booking.addon_service_ids
    ? booking.addon_service_ids.split(',').map(Number)
    : [];
  const addonServices = addonIds.length ? serviceDao.findByIds(addonIds) : [];
  const serviceTotal = mainService ? mainService.price : 0;
  const addonTotal = addonServices.reduce((s, a) => s + a.price, 0);
  const totalAmount = serviceTotal + addonTotal;

  if (parsedDiscount < 0) {
    return res.status(400).json({ code: 1, message: '优惠金额不能为负数' });
  }
  if (parsedDiscount > totalAmount) {
    return res.status(400).json({
      code: 1,
      message: `优惠金额(¥${parsedDiscount})不能超过应付总额(¥${totalAmount})`
    });
  }
  const discountAmount = Math.min(parsedDiscount, totalAmount);

  let depositUsed = 0;
  if (use_deposit && booking.deposit_amount > 0 && booking.deposit_status === 'paid') {
    depositUsed = booking.deposit_amount;
  }

  if (parsedStoredValue < 0) {
    return res.status(400).json({ code: 1, message: '储值抵扣金额不能为负数' });
  }

  const cardUsedDetail = [];
  let cardUsedCount = 0;
  const remainingByService = {};

  for (const cardUse of use_service_cards || []) {
    const svcId = parseInt(cardUse.service_id);
    const count = parseInt(cardUse.count) || 1;
    if (!svcId || count <= 0) continue;

    if (!remainingByService[svcId]) {
      remainingByService[svcId] = [];
      if (svcId === booking.service_id) {
        remainingByService[svcId].push({ is_main: true, price: serviceTotal });
      }
      for (const add of addonServices) {
        if (add.id === svcId) {
          remainingByService[svcId].push({ is_main: false, price: add.price, addon_id: add.id });
        }
      }
    }
    const available = remainingByService[svcId];
    if (available.length < count) {
      const svc = serviceDao.findById(svcId);
      return res.status(400).json({
        code: 1,
        message: `请求扣次卡"${svc ? svc.name : 'ID=' + svcId}"${count}次，但该预约只包含${available.length}次该服务`
      });
    }
    for (let i = 0; i < count && available.length > 0; i++) {
      available.shift();
      cardUsedCount += 1;
      cardUsedDetail.push({ service_id: svcId, count: 1 });
    }
  }

  const svcPriceFromCards = cardUsedDetail.reduce((s, c) => {
    if (c.service_id === booking.service_id) return s + serviceTotal;
    const addon = addonServices.find(a => a.id === c.service_id);
    return s + (addon ? addon.price : 0);
  }, 0);

  const preActual = totalAmount - discountAmount - depositUsed - parsedStoredValue - svcPriceFromCards;
  const actualAmount = Math.max(0, preActual);

  if (actualAmount > 0 && !['cash', 'wechat', 'alipay', 'card', 'stored_value'].includes(payment_method)) {
    return res.status(400).json({
      code: 1,
      message: `实收金额¥${actualAmount}需要指定合法支付方式(cash/wechat/alipay/card/stored_value)`
    });
  }

  const member = memberDao.findByPhone(booking.customer_phone);
  const storedValueRequired = parsedStoredValue + (payment_method === 'stored_value' ? actualAmount : 0);
  if (storedValueRequired > 0) {
    if (!member) {
      return res.status(400).json({ code: 1, message: '该手机号非会员，无法使用储值' });
    }
    if ((member.stored_value || 0) < storedValueRequired) {
      return res.status(400).json({
        code: 1,
        message: `储值余额不足，需¥${storedValueRequired}，当前余额¥${member.stored_value || 0}`
      });
    }
  }

  const cardCounts = {};
  for (const c of cardUsedDetail) {
    cardCounts[c.service_id] = (cardCounts[c.service_id] || 0) + c.count;
  }
  for (const [svcIdStr, cnt] of Object.entries(cardCounts)) {
    const available = memberCardDao.findAvailableByPhoneAndService(booking.customer_phone, parseInt(svcIdStr));
    const totalRemain = available.reduce((s, a) => s + (a.remaining_count || 0), 0);
    if (totalRemain < cnt) {
      const svc = serviceDao.findById(parseInt(svcIdStr));
      return res.status(400).json({
        code: 1,
        message: `次卡"${svc ? svc.name : 'ID=' + svcIdStr}"剩余次数不足，需${cnt}次，当前剩${totalRemain}次`
      });
    }
  }

  let result;
  try {
    result = db.transaction((t) => {
      const snapMember = t.findOne('members', r => r.phone === booking.customer_phone);
      if (storedValueRequired > 0) {
        if (!snapMember) throw new Error('会员不存在');
        if ((snapMember.stored_value || 0) < storedValueRequired) {
          throw new Error(`储值余额不足，需¥${storedValueRequired}，当前余额¥${snapMember.stored_value || 0}`);
        }
        t.update('members', snapMember.id, {
          stored_value: (snapMember.stored_value || 0) - storedValueRequired,
          total_consume: (snapMember.total_consume || 0) + storedValueRequired
        });
      }

      for (const [svcIdStr, cnt] of Object.entries(cardCounts)) {
        const svcId = parseInt(svcIdStr);
        const cards = t.findMany('member_cards', r =>
          r.customer_phone === booking.customer_phone &&
          r.service_id === svcId &&
          r.status === 'active' &&
          (r.remaining_count || 0) > 0
        ).sort((a, b) => {
          if (a.expire_date && b.expire_date) return a.expire_date.localeCompare(b.expire_date);
          if (a.expire_date) return -1;
          if (b.expire_date) return 1;
          return a.id - b.id;
        });
        let remain = cnt;
        for (const card of cards) {
          if (remain <= 0) break;
          const consume = Math.min(card.remaining_count || 0, remain);
          t.update('member_cards', card.id, {
            remaining_count: (card.remaining_count || 0) - consume,
            used_count: (card.used_count || 0) + consume
          });
          remain -= consume;
        }
        if (remain > 0) throw new Error('次卡扣款失败，次数不足');
      }

      const snapBooking = t.findById('bookings', bookingId);
      if (!snapBooking) throw new Error('预约不存在');
      const bookingUpdates = { status: 'completed' };
      if (!snapBooking.completed_at) bookingUpdates.completed_at = new Date().toISOString();
      if (remark) bookingUpdates.remark = remark;
      if (depositUsed > 0 && snapBooking.deposit_status === 'paid') {
        bookingUpdates.deposit_status = 'used';
        bookingUpdates.deposit_used_at = new Date().toISOString();
        if (remark) bookingUpdates.deposit_note = remark;
      }
      t.update('bookings', bookingId, bookingUpdates);

      const txnNo = 'TXN' + new Date().toISOString().slice(0, 10).replace(/-/g, '') +
        String(t.findAll('transactions').filter(r => r.transaction_no &&
          r.transaction_no.startsWith('TXN' + new Date().toISOString().slice(0, 10).replace(/-/g, ''))).length + 1).padStart(4, '0');

      const txn = t.insert('transactions', {
        transaction_no: txnNo,
        booking_id: bookingId,
        customer_name: booking.customer_name,
        customer_phone: booking.customer_phone,
        employee_id: booking.employee_id,
        transaction_date: new Date().toISOString().slice(0, 10),
        service_total: serviceTotal,
        addon_total: addonTotal,
        discount_amount: discountAmount,
        deposit_used: depositUsed,
        stored_value_used: storedValueRequired,
        service_card_used_count: cardUsedCount,
        service_card_used_detail: cardUsedDetail.length ? JSON.stringify(cardUsedDetail) : null,
        total_amount: totalAmount,
        actual_amount: actualAmount,
        payment_method: cardUsedCount > 0 && actualAmount === 0 ? 'service_card' : payment_method,
        payment_detail: payment_detail ? JSON.stringify(payment_detail) : null,
        remark: remark || null,
        status: 'completed'
      });

      return { txn };
    });
  } catch (e) {
    return res.status(400).json({
      code: 1,
      message: `结账失败，所有扣款已回滚：${e.message}`
    });
  }

  const memberAfter = memberDao.findByPhone(booking.customer_phone);
  const cardsAfter = memberCardDao.findAll({ phone: booking.customer_phone, status: 'active' });

  res.json({
    code: 0,
    data: {
      booking: bookingDao.findById(bookingId),
      transaction: transactionDao.findById(result.txn.id)
    },
    summary: {
      service_total: serviceTotal,
      addon_total: addonTotal,
      total_amount: totalAmount,
      discount_amount: discountAmount,
      deposit_used: depositUsed,
      stored_value_used: storedValueRequired,
      service_card_used_count: cardUsedCount,
      actual_amount: actualAmount,
      payment_method: cardUsedCount > 0 && actualAmount === 0 ? 'service_card' : payment_method
    },
    member_remaining: {
      stored_value: memberAfter ? memberAfter.stored_value || 0 : 0,
      cards: cardsAfter
    },
    rollback_guaranteed: true,
    message: '结账成功，若中途失败所有余额和次数自动回滚'
  });
});

router.get('/booking/:bookingId', (req, res) => {
  const bookingId = parseInt(req.params.bookingId);
  const txns = transactionDao.findByBookingId(bookingId);
  res.json({ code: 0, data: txns });
});

module.exports = router;
