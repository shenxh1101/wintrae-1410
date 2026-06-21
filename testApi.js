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
    console.log('✓ 成功:', JSON.stringify(data.data || data.message || data).slice(0, 400));
  } else if (!pass || (data && data.code !== 0)) {
    console.log('✓ 预期失败:', data && data.message || JSON.stringify(data).slice(0, 400));
  } else {
    console.log('✗ 异常:', JSON.stringify(data).slice(0, 400));
  }
};

(async () => {
  console.log('\n========= 理发店预约服务 API 测试 =========\n');

  log('1.首页', await request('GET', '/'));

  log('2.员工列表', await request('GET', '/api/employees'));

  log('3.服务项目', await request('GET', '/api/services'));

  log('4.今日排班', await request('GET', '/api/schedules?start_date=2026-06-22&end_date=2026-06-22'));

  log('5.发型师1空档', await request('GET', '/api/slots/employee/1?date=2026-06-22'));

  log('6.项目(男士剪发)可约时段', await request('GET', '/api/slots/service/1?date=2026-06-22'));

  const newBooking = await request('POST', '/api/bookings', {
    customer_name: '测试客户A',
    customer_phone: '13900008888',
    employee_id: 2,
    service_id: 1,
    booking_date: '2026-06-22',
    start_time: '11:15',
    source: 'frontdesk',
    hair_note: '油性发质，头皮敏感',
    remark: '加做刘海修剪'
  });
  log('7.创建预约(成功)', newBooking);

  const conflictBooking = await request('POST', '/api/bookings', {
    customer_name: '冲突客户',
    customer_phone: '13900009999',
    employee_id: 2,
    service_id: 1,
    booking_date: '2026-06-22',
    start_time: '11:30'
  });
  log('8.创建预约(冲突校验)', conflictBooking);

  const dupBooking = await request('POST', '/api/bookings', {
    customer_name: '重复预约',
    customer_phone: '13900008888',
    employee_id: 3,
    service_id: 1,
    booking_date: '2026-06-22',
    start_time: '15:00'
  });
  log('9.创建预约(同顾客同日重复)', dupBooking);

  const offBooking = await request('POST', '/api/bookings', {
    customer_name: '休息日预约',
    customer_phone: '13900007777',
    employee_id: 1,
    service_id: 1,
    booking_date: '2026-06-24',
    start_time: '10:00'
  });
  log('10.创建预约(休息日校验)', offBooking);

  const bookingId = newBooking.data ? newBooking.data.id : null;
  if (bookingId) {
    log('11.确认预约', await request('POST', `/api/bookings/${bookingId}/confirm`));
    log('12.到店确认', await request('POST', `/api/bookings/${bookingId}/arrive`));
    log('13.服务完成', await request('POST', `/api/bookings/${bookingId}/complete`));
    log('14.查询预约详情', await request('GET', `/api/bookings/${bookingId}`));
  }

  const newBooking2 = await request('POST', '/api/bookings', {
    customer_name: '改期测试',
    customer_phone: '13900006666',
    employee_id: 3,
    service_id: 2,
    booking_date: '2026-06-22',
    start_time: '16:30'
  });
  log('15.创建预约(用于改期)', newBooking2);
  const bk2Id = newBooking2.data ? newBooking2.data.id : null;
  if (bk2Id) {
    log('16.改期', await request('POST', `/api/bookings/${bk2Id}/reschedule`, {
      booking_date: '2026-06-23',
      start_time: '14:00'
    }));
    log('17.取消预约', await request('POST', `/api/bookings/${bk2Id}/cancel`));
  }

  log('18.候补名单', await request('GET', '/api/waitlist'));
  const newWait = await request('POST', '/api/waitlist', {
    customer_name: '候补测试',
    customer_phone: '13900005555',
    employee_id: 1,
    service_id: 2,
    preferred_date: '2026-06-22',
    preferred_times: '14:00,15:00',
    hair_note: '细软发质',
    remark: '尽量安排下午'
  });
  log('19.加入候补', newWait);
  const waitId = newWait.data ? newWait.data.id : null;
  if (waitId) {
    log('20.查询可用时段(pre-notify)', await request('GET', `/api/waitlist/${waitId}/pre-notify`));
    log('21.通知候补', await request('POST', `/api/waitlist/${waitId}/notify`));
  }

  log('22.今日预约列表', await request('GET', '/api/bookings?booking_date=2026-06-22'));

  log('23.管理端统计', await request('GET', '/api/admin/dashboard/2026-06-22'));

  log('24.工位占用热力图', await request('GET', '/api/admin/station-occupancy/2026-06-22'));

  log('25.系统配置', await request('GET', '/api/system/configs'));

  log('26.收入统计(近7天)', await request('GET', '/api/admin/revenue?start_date=2026-06-22&end_date=2026-06-28'));

  console.log('\n=== 新增功能测试 ===\n');

  const badAddonBooking = await request('POST', '/api/bookings', {
    customer_name: '加做项目测试',
    customer_phone: '13900004444',
    employee_id: 2,
    service_id: 1,
    addon_service_ids: [999, 2],
    booking_date: '2026-06-22',
    start_time: '17:00'
  });
  log('27.加做项目校验(不存在项目ID=999)', badAddonBooking, false);

  const badAssistantBooking = await request('POST', '/api/bookings', {
    customer_name: '助理校验测试',
    customer_phone: '13900004444',
    employee_id: 2,
    assistant_id: 1,
    service_id: 1,
    booking_date: '2026-06-22',
    start_time: '17:00'
  });
  log('28.指定助理校验(发型师作为助理)', badAssistantBooking, false);

  log('29.顾客信息查询(13900008888)', await request('GET', '/api/customers/profile/13900008888'));

  log('30.顾客预约记录', await request('GET', '/api/customers/bookings/13900008888'));

  const noShowCustomer = await request('POST', '/api/bookings', {
    customer_name: '高频爽约客户',
    customer_phone: '13800002222',
    employee_id: 2,
    service_id: 1,
    booking_date: '2026-06-23',
    start_time: '10:00',
    source: 'frontdesk'
  });
  if (noShowCustomer.data) {
    const nsId = noShowCustomer.data.id;
    await request('POST', `/api/bookings/${nsId}/no-show`);
  }

  const noShowCustomer2 = await request('POST', '/api/bookings', {
    customer_name: '高频爽约客户',
    customer_phone: '13800002222',
    employee_id: 3,
    service_id: 1,
    booking_date: '2026-06-25',
    start_time: '10:00',
    source: 'frontdesk'
  });
  if (noShowCustomer2.data) {
    const nsId2 = noShowCustomer2.data.id;
    await request('POST', `/api/bookings/${nsId2}/no-show`);
  }

  const riskBooking = await request('POST', '/api/bookings', {
    customer_name: '高频爽约客户',
    customer_phone: '13800002222',
    employee_id: 2,
    service_id: 1,
    booking_date: '2026-06-26',
    start_time: '11:00',
    source: 'online'
  });
  log('31.风险客户线上预约(自动待人工确认)', riskBooking);
  console.log('  → 状态:', riskBooking.data && riskBooking.data.status);
  console.log('  → 风险标记:', riskBooking.data && riskBooking.data.is_risk);

  const riskBookingId = riskBooking.data ? riskBooking.data.id : null;
  if (riskBookingId) {
    log('32.确认待审核预约', await request('POST', `/api/bookings/${riskBookingId}/confirm`));
  }

  log('33.管理端统计(含风险标记)', await request('GET', '/api/admin/dashboard/2026-06-26'));

  const depositService = await request('POST', '/api/services', {
    name: '订金测试项目',
    duration_minutes: 60,
    price: 500,
    deposit: 100,
    require_deposit: 1,
    category: 'test',
    description: '测试订金功能'
  });
  log('34.创建需订金项目', depositService);

  const depositBooking = await request('POST', '/api/bookings', {
    customer_name: '订金测试客户',
    customer_phone: '13900003333',
    employee_id: 2,
    service_id: depositService.data ? depositService.data.id : 3,
    booking_date: '2026-06-22',
    start_time: '18:00',
    source: 'online'
  });
  log('35.需订金项目预约', depositBooking);
  console.log('  → 订金信息:', JSON.stringify(depositBooking.deposit || depositBooking.data?.deposit));

  log('36.顾客信息查询(含风险)', await request('GET', '/api/customers/profile/13800002222'));

  console.log('\n========= 所有测试完成 =========\n');
})().catch(e => console.error('测试异常:', e));
