const db = require('../db');
const configDao = require('../daos/configDao');

db.load();
configDao.initDefaultConfigs();
db.persist(true);

console.log('数据库初始化完成，配置表已写入默认值');
