const http = require('http');

const request = (method, path, body = null) => {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(options, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { resolve({ raw: buf }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
};

const log = (label, data, pass = true) => {
  console.log(`\n=== ${label} ===`);
  if (pass && data && (data.code === 0 || data.success)) {
    const d = data.data || data.message || data;
    console.log('✓ 成功:', typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d).slice(0, 200));
  } else if (!pass || (data && data.code !== 0 && !data.success)) {
    console.log('✓ 预期失败:', data && data.message || JSON.stringify(data).slice(0, 200));
  } else {
    console.log('✗ 异常:', JSON.stringify(data).slice(0, 300));
  }
};

const p = (k, v) => {
  console.log(`  → ${k}:`, v === undefined ? 'N/A' : (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v).slice(0, 200)));
};

(async () => {
  console.log('\n========= 理发店收银+会员+候补 增强版测试 =========\n');

  const svc = await request('POST', '/api/services', {
    name: '女士剪发+造型',
    duration_minutes: 60,
    price: 188,
    deposit: 50,
    require_deposit: 1,
    category: '剪发',
    is_active: 1
  });
  log('1.创建服务(含订金)', svc);
  const serviceId = svc.data && svc.data.id;

  const memberPhone = '13300001111';
  const member = await request('POST', '/api/members', {
    name: 'VIP测试会员',
    phone: memberPhone,
    stored_value: 0,
    level: '黄金会员'
  });
  log('2.创建会员账户', member);

  const recharge = await request('POST', '/api/members/recharge', {
    phone: memberPhone,
    amount: 2000
  });
  log('3.会员储值充值2000', recharge);
  p('储值后余额', recharge.data && recharge.data.stored_value);
  p('累计充值', recharge.data && recharge.data.total_recharge);

  const buyCard = await request('POST', '/api/members/cards/purchase', {
    phone: memberPhone,
    name: 'VIP测试会员',
    service_id: 1,
    total_count: 5,
    paid_amount: 300
  });
  log('4.购买次卡(男士剪发×5次,¥300)', buyCard);
  p('卡ID', buyCard.data && buyCard.data.id);
  p('剩余次数', buyCard.data && buyCard.data.remaining_count);
  p('服务名', buyCard.data && buyCard.data.service_name);

  const memberInfo = await request('GET', `/api/members/${memberPhone}`);
  log('5.查询会员权益', memberInfo);
  p('储值余额', memberInfo.data && memberInfo.data.stored_value);
  p('有效次卡张数', memberInfo.data && memberInfo.data.cards && memberInfo.data.cards.length);

  const createBk = await request('POST', '/api/bookings', {
    customer_name: 'VIP测试会员',
    customer_phone: memberPhone,
    employee_id: 2,
    service_id: serviceId,
    booking_date: '2026-06-23',
    start_time: '14:00',
    source: 'frontdesk'
  });
  log('6.前台创建会员预约', createBk);
  const bkId = createBk.data && createBk.data.id;
  p('预约状态', createBk.data && createBk.data.status);
  p('订金金额', createBk.deposit && createBk.deposit.amount);
  p('订金状态', createBk.deposit && createBk.deposit.status);
  p('会员储值余额', createBk.member_info && createBk.member_info.stored_value);
  p('会员有效次卡', createBk.member_info && createBk.member_info.active_cards && createBk.member_info.active_cards.length);

  if (bkId) {
    const payDep = await request('POST', `/api/bookings/${bkId}/deposit/pay`, {
      note: '前台订金已收'
    });
    log('7.标记已收订金', payDep);

    const arrive = await request('POST', `/api/bookings/${bkId}/arrive`);
    log('8.标记顾客到店', arrive);

    const checkout = await request('POST', `/api/transactions/${bkId}/checkout`, {
      discount_amount: 38,
      use_deposit: true,
      payment_method: 'cash',
      remark: '新客优惠38元'
    });
    log('9.到店结账(优惠+订金抵扣+现金)', checkout);
    p('总金额', checkout.summary && checkout.summary.total_amount);
    p('优惠金额', checkout.summary && checkout.summary.discount_amount);
    p('订金抵扣', checkout.summary && checkout.summary.deposit_used);
    p('实收金额', checkout.summary && checkout.summary.actual_amount);
    p('支付方式', checkout.summary && checkout.summary.payment_method);
    p('消费单号', checkout.data && checkout.data.transaction && checkout.data.transaction.transaction_no);
    p('预约状态', checkout.data && checkout.data.booking && checkout.data.booking.status);

    const recheckout = await request('POST', `/api/transactions/${bkId}/checkout`, {});
    log('10.重复结账(幂等性)', recheckout);
    p('是否重复', recheckout.is_duplicate);
    p('消费单数量', recheckout.transactions && recheckout.transactions.length);
  }

  const bk2 = await request('POST', '/api/bookings', {
    customer_name: 'VIP测试会员',
    customer_phone: memberPhone,
    employee_id: 1,
    service_id: 1,
    booking_date: '2026-06-24',
    start_time: '10:00',
    source: 'frontdesk'
  });
  log('11.创建预约(男士剪发,用次卡)', bk2);
  const bk2Id = bk2.data && bk2.data.id;
  p('可用次卡数', bk2.member_info && bk2.member_info.available_for_this_service && bk2.member_info.available_for_this_service.length);

  if (bk2Id) {
    await request('POST', `/api/bookings/${bk2Id}/arrive`);
    const ck2 = await request('POST', `/api/transactions/${bk2Id}/checkout`, {
      use_service_cards: [{ service_id: 1, count: 1 }],
      remark: '扣次卡结账'
    });
    log('12.结账(次卡扣1次)', ck2);
    p('总金额', ck2.summary && ck2.summary.total_amount);
    p('次卡使用次数', ck2.summary && ck2.summary.service_card_used_count);
    p('实收金额', ck2.summary && ck2.summary.actual_amount);
    p('支付方式', ck2.summary && ck2.summary.payment_method);
    p('剩余储值', ck2.member_remaining && ck2.member_remaining.stored_value);
    p('剩余次卡数', ck2.member_remaining && ck2.member_remaining.cards && ck2.member_remaining.cards.reduce((s, c) => s + (c.remaining_count || 0), 0));
  }

  const bk3 = await request('POST', '/api/bookings', {
    customer_name: 'VIP测试会员',
    customer_phone: memberPhone,
    employee_id: 3,
    service_id: serviceId,
    booking_date: '2026-06-25',
    start_time: '11:00',
    source: 'frontdesk'
  });
  log('13.创建预约(扣储值)', bk3);
  const bk3Id = bk3.data && bk3.data.id;

  if (bk3Id) {
    await request('POST', `/api/bookings/${bk3Id}/arrive`);
    const ck3 = await request('POST', `/api/transactions/${bk3Id}/checkout`, {
      payment_method: 'stored_value',
      remark: '全部扣储值'
    });
    log('14.结账(储值卡扣全款)', ck3);
    p('总金额', ck3.summary && ck3.summary.total_amount);
    p('储值扣款', ck3.summary && ck3.summary.stored_value_used);
    p('实收', ck3.summary && ck3.summary.actual_amount);
    p('支付方式', ck3.summary && ck3.summary.payment_method);
    p('剩余储值', ck3.member_remaining && ck3.member_remaining.stored_value);
  }

  const waitPhone = '13300002222';
  const wait1 = await request('POST', '/api/waitlist', {
    customer_name: '候补追踪测试',
    customer_phone: waitPhone,
    employee_id: 1,
    service_id: 1,
    preferred_date: '2026-06-26',
    preferred_times: '10:00,11:00',
    remark: '追踪关联测试'
  });
  log('15.创建候补记录', wait1);
  const waitId = wait1.data && wait1.data.id;

  if (waitId) {
    const pre = await request('GET', `/api/waitlist/${waitId}/pre-notify`);
    log('16.候补预查时段', pre);
    p('可用时段数', pre.available_slots && pre.available_slots.length);

    if (pre.available_slots && pre.available_slots.length > 0) {
      const slot = pre.available_slots[0];
      const cfm = await request('POST', `/api/waitlist/${waitId}/confirm-booking`, {
        start_time: slot.start_time,
        employee_id: slot.employee_id
      });
      log('17.候补确认成单', cfm);
      const bkIdFromWait = cfm.data && cfm.data.id;
      p('预约号', cfm.data && cfm.data.booking_no);
      p('是否重复', cfm.is_duplicate);

      const cfm2 = await request('POST', `/api/waitlist/${waitId}/confirm-booking`, {
        start_time: slot.start_time,
        employee_id: slot.employee_id
      });
      log('18.重复确认候补(幂等性)', cfm2);
      p('是否重复', cfm2.is_duplicate);
      p('同一预约ID', cfm2.data && cfm2.data.id);

      const waitDetail = await request('GET', `/api/waitlist/${waitId}`);
      log('19.候补详情(追踪关联)', waitDetail);
      p('候补状态', waitDetail.data && waitDetail.data.status);
      p('关联预约号', waitDetail.data && waitDetail.data.confirmed_booking_no);
      p('关联预约时间', waitDetail.data && waitDetail.data.confirmed_booking_time);
      p('关联发型师', waitDetail.data && waitDetail.data.confirmed_booking_stylist);
      p('关联预约详情ID', waitDetail.data && waitDetail.data.confirmed_booking && waitDetail.data.confirmed_booking.id);
    }
  }

  const batchSvc = await request('GET', `/api/services/batch/query?ids=1,2,999,3`);
  log('20.服务项目批量查询', batchSvc);
  p('请求ID数', batchSvc.requested_ids && batchSvc.requested_ids.length);
  p('返回项目数', batchSvc.found_count);
  p('不存在项目', batchSvc.not_found && batchSvc.not_found.length);
  p('停用项目', batchSvc.inactive && batchSvc.inactive.length);
  if (batchSvc.not_found && batchSvc.not_found.length > 0) {
    p('不存在提示', batchSvc.not_found[0].message);
  }

  const dsh = await request('GET', '/api/admin/dashboard/2026-06-23');
  log('21.日看板(按支付方式统计)', dsh);
  const byMethod = dsh.data && dsh.data.summary && dsh.data.summary.revenue_by_method;
  p('总收款额', byMethod && byMethod.total_amount);
  p('支付笔数', byMethod && byMethod.total_count);
  p('支付方式数', byMethod && byMethod.by_method && byMethod.by_method.length);
  if (byMethod && byMethod.by_method) {
    for (const m of byMethod.by_method) {
      p(`  方式[${m.payment_method}]`, `¥${m.total_amount} × ${m.count}笔`);
    }
  }

  const txnList = await request('GET', '/api/transactions/booking/' + bkId);
  log('22.查看预约关联的消费单', txnList);
  p('消费单数量', txnList.data && txnList.data.length);
  if (txnList.data && txnList.data.length > 0) {
    p('消费单号', txnList.data[0].transaction_no);
    p('实收金额', txnList.data[0].actual_amount);
    p('订金抵扣', txnList.data[0].deposit_used);
  }

  console.log('\n========= 所有测试完成 =========\n');
})().catch(e => console.error('测试异常:', e));
