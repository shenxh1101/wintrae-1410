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
  if (pass && data && data.code === 0) {
    console.log('✓ 成功:', JSON.stringify(data.data || data.message || data).slice(0, 300));
  } else if (!pass || (data && data.code !== 0)) {
    console.log('✓ 预期失败:', data && data.message || JSON.stringify(data).slice(0, 300));
  } else {
    console.log('✗ 异常:', JSON.stringify(data).slice(0, 300));
  }
};

(async () => {
  console.log('\n========= 理发店预约服务 API 测试(增强版) =========\n');

  log('1.首页', await request('GET', '/'));

  log('2.员工列表', await request('GET', '/api/employees'));

  log('3.服务项目', await request('GET', '/api/services'));

  const newSvc = await request('POST', '/api/services', {
    name: '烫发护理套餐',
    duration_minutes: 120,
    price: 680,
    category: '烫染',
    description: '含烫前护理',
    is_active: 1
  });
  log('4.创建服务项目', newSvc);
  const svcId = newSvc.data ? newSvc.data.id : null;

  if (svcId) {
    const patchSvc = await request('PUT', `/api/services/${svcId}`, {
      deposit: 200,
      require_deposit: 1
    });
    log('5.部分更新服务(只改订金)', patchSvc);
    if (patchSvc.data) {
      console.log('  → 名称保持:', patchSvc.data.name);
      console.log('  → 价格保持:', patchSvc.data.price);
      console.log('  → 新订金:', patchSvc.data.deposit, '/ 需要订金:', patchSvc.data.require_deposit);
    }
  }

  log('6.今日排班', await request('GET', '/api/schedules?start_date=2026-06-22&end_date=2026-06-22'));

  log('7.发型师1空档', await request('GET', '/api/slots/employee/1?date=2026-06-22'));

  log('8.项目(男士剪发)可约时段', await request('GET', '/api/slots/service/1?date=2026-06-22'));

  const frontdeskBooking = await request('POST', '/api/bookings', {
    customer_name: '前台测试客户',
    customer_phone: '13700006666',
    employee_id: 2,
    service_id: svcId || 3,
    booking_date: '2026-06-22',
    start_time: '17:30',
    source: 'frontdesk',
    hair_note: '自然卷'
  });
  log('9.前台创建预约(含订金项目)', frontdeskBooking);
  const bkId = frontdeskBooking.data ? frontdeskBooking.data.id : null;
  if (frontdeskBooking.deposit) {
    console.log('  → 订金信息:', JSON.stringify(frontdeskBooking.deposit));
  }
  if (frontdeskBooking.customer_info && frontdeskBooking.customer_info.summary) {
    const s = frontdeskBooking.customer_info.summary;
    console.log('  → 顾客摘要: 总预约', s.total_bookings, '总消费', s.total_spent);
  }

  const onlineBooking = await request('POST', '/api/bookings', {
    customer_name: '线上测试客户',
    customer_phone: '13700005555',
    employee_id: 3,
    service_id: svcId || 3,
    booking_date: '2026-06-22',
    start_time: '18:00',
    source: 'online'
  });
  log('10.线上创建预约(待支付订金)', onlineBooking);
  const onlineBkId = onlineBooking.data ? onlineBooking.data.id : null;
  if (onlineBooking.deposit) {
    console.log('  → 订金状态:', onlineBooking.deposit.status, '/ 金额:', onlineBooking.deposit.amount);
    console.log('  → 支付截止:', onlineBooking.deposit.expire_at);
  }

  if (onlineBkId) {
    log('11.标记订金已收', await request('POST', `/api/bookings/${onlineBkId}/deposit/pay`, {
      note: '前台扫码收款'
    }));

    log('12.重复支付订金(预期失败)',
      await request('POST', `/api/bookings/${onlineBkId}/deposit/pay`), false);

    log('13.订金退款', await request('POST', `/api/bookings/${onlineBkId}/deposit/refund`, {
      note: '顾客取消预约'
    }));

    log('14.已退款后再次支付(预期失败)',
      await request('POST', `/api/bookings/${onlineBkId}/deposit/pay`), false);
  }

  const depositUseBooking = await request('POST', '/api/bookings', {
    customer_name: '抵扣测试客户',
    customer_phone: '13700004444',
    employee_id: 1,
    service_id: svcId || 3,
    booking_date: '2026-06-23',
    start_time: '10:00',
    source: 'frontdesk'
  });
  const depUseId = depositUseBooking.data ? depositUseBooking.data.id : null;
  if (depUseId) {
    await request('POST', `/api/bookings/${depUseId}/deposit/pay`);
    log('15.订金到店抵扣', await request('POST', `/api/bookings/${depUseId}/deposit/use`, {
      note: '到店确认，订金抵扣尾款'
    }));
  }

  log('16.加做项目校验(不存在项目)',
    await request('POST', '/api/bookings', {
      customer_name: '加做测试',
      customer_phone: '13700003333',
      employee_id: 2,
      service_id: 1,
      addon_service_ids: [999, 2],
      booking_date: '2026-06-22',
      start_time: '19:00'
    }), false);

  log('17.指定助理校验(发型师作为助理)',
    await request('POST', '/api/bookings', {
      customer_name: '助理测试',
      customer_phone: '13700003333',
      employee_id: 2,
      assistant_id: 1,
      service_id: 1,
      booking_date: '2026-06-22',
      start_time: '19:00'
    }), false);

  const newWait = await request('POST', '/api/waitlist', {
    customer_name: '候补成单测试',
    customer_phone: '13600008888',
    employee_id: 1,
    service_id: 1,
    preferred_date: '2026-06-23',
    preferred_times: '10:00,11:00',
    hair_note: '油性发质',
    remark: '确认后直接成单'
  });
  log('18.加入候补', newWait);
  const waitId = newWait.data ? newWait.data.id : null;

  if (waitId) {
    const preNotify = await request('GET', `/api/waitlist/${waitId}/pre-notify`);
    log('19.候补预通知(查时段)', preNotify);
    console.log('  → 可用时段数:', preNotify.available_slots ? preNotify.available_slots.length : 0);
    console.log('  → 候补状态未变:', newWait.data.status);

    let firstSlot = null;
    if (preNotify.available_slots && preNotify.available_slots.length > 0) {
      firstSlot = preNotify.available_slots[0];
    }

    if (firstSlot) {
      const confirm1 = await request('POST', `/api/waitlist/${waitId}/confirm-booking`, {
        start_time: firstSlot.start_time,
        employee_id: firstSlot.employee_id
      });
      log('20.候补确认成单', confirm1);
      console.log('  → 预约ID:', confirm1.data && confirm1.data.id);
      console.log('  → 预约状态:', confirm1.data && confirm1.data.status);
      console.log('  → 是否重复:', confirm1.is_duplicate);
      console.log('  → 预约号:', confirm1.data && confirm1.data.booking_no);

      const confirm2 = await request('POST', `/api/waitlist/${waitId}/confirm-booking`, {
        start_time: firstSlot.start_time,
        employee_id: firstSlot.employee_id
      });
      log('21.重复确认候补(幂等性)', confirm2);
      console.log('  → 是否重复:', confirm2.is_duplicate);
      console.log('  → 同一预约ID:', confirm2.data && confirm2.data.id);
      console.log('  → 同一预约号:', confirm2.data && confirm2.data.booking_no);

      const waitDetail = await request('GET', `/api/waitlist/${waitId}`);
      log('22.候补详情(含关联预约)', waitDetail);
      console.log('  → 候补状态:', waitDetail.data && waitDetail.data.status);
      console.log('  → 关联预约ID:', waitDetail.data && waitDetail.data.confirmed_booking_id);
      console.log('  → 关联预约详情:', waitDetail.data && waitDetail.data.confirmed_booking ? '有' : '无');
    }
  }

  log('23.顾客信息查询(13700006666)', await request('GET', '/api/customers/profile/13700006666'));

  const riskPhone = '13500001111';
  for (let i = 0; i < 3; i++) {
    const b = await request('POST', '/api/bookings', {
      customer_name: '高频爽约测试',
      customer_phone: riskPhone,
      employee_id: (i % 3) + 1,
      service_id: 1,
      booking_date: `2026-06-${23 + i}`,
      start_time: '10:00',
      source: 'frontdesk'
    });
    if (b.data) {
      await request('POST', `/api/bookings/${b.data.id}/no-show`, {
        reason: i === 0 ? '顾客忘来了' : (i === 1 ? '临时有事取消晚了' : '联系不上')
      });
    }
  }

  const riskProfile = await request('GET', `/api/customers/profile/${riskPhone}`);
  log('24.顾客画像(高频爽约客户)', riskProfile);
  if (riskProfile.data) {
    const d = riskProfile.data;
    console.log('  → 总预约:', d.total_bookings);
    console.log('  → 爽约次数:', d.no_show_count);
    console.log('  → 最近爽约:', JSON.stringify(d.last_no_show));
    console.log('  → 常用项目:', JSON.stringify(d.top_services));
    console.log('  → 发质备注:', JSON.stringify(d.hair_notes));
    console.log('  → 最近消费:', d.recent_consumptions ? d.recent_consumptions.length + '条' : '无');
  }

  const riskOnlineBooking = await request('POST', '/api/bookings', {
    customer_name: '高频爽约测试',
    customer_phone: riskPhone,
    employee_id: 2,
    service_id: 2,
    booking_date: '2026-06-29',
    start_time: '11:00',
    source: 'online'
  });
  log('25.风险客户线上预约(待人工确认)', riskOnlineBooking);
  console.log('  → 预约状态:', riskOnlineBooking.data && riskOnlineBooking.data.status);
  console.log('  → 风险标记:', riskOnlineBooking.data && riskOnlineBooking.data.is_risk);
  if (riskOnlineBooking.customer_info) {
    console.log('  → 顾客摘要:', riskOnlineBooking.customer_info.summary ? '有' : '无');
  }

  log('26.管理端日看板(2026-06-22)', await request('GET', '/api/admin/dashboard/2026-06-22'));
  const dsh22 = await request('GET', '/api/admin/dashboard/2026-06-22');
  if (dsh22.data && dsh22.data.summary) {
    const s = dsh22.data.summary;
    console.log('  → 应收订金:', s.expected_deposit);
    console.log('  → 已收订金:', s.paid_deposit);
    console.log('  → 已退订金:', s.refunded_deposit);
    console.log('  → 待支付数:', s.unpaid_deposit_count);
    console.log('  → 风险预约:', s.risk_booking_count);
    console.log('  → 待审核预约:', s.pending_review_count);
  }

  log('27.系统配置', await request('GET', '/api/system/configs'));

  log('28.收入统计(近7天)', await request('GET', '/api/admin/revenue?start_date=2026-06-22&end_date=2026-06-28'));

  console.log('\n========= 所有测试完成 =========\n');
})().catch(e => console.error('测试异常:', e));
