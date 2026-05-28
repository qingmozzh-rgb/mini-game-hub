/**
 * 数据库自动初始化脚本
 * 运行: npm run init-db
 * 会自动根据 .env 中的 MySQL 配置创建数据库和表
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// 从环境变量读取配置，未设置则用默认值
const DB_CONFIG = {
  host:     process.env.DB_HOST || 'localhost',
  port:     process.env.DB_PORT || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'mini_game_hub',
  charset:  'utf8mb4'
};

async function init() {
  // 先连 MySQL（不指定数据库）
  const conn = await mysql.createConnection({
    host:     DB_CONFIG.host,
    port:     DB_CONFIG.port,
    user:     DB_CONFIG.user,
    password: DB_CONFIG.password,
    multipleStatements: true
  });

  console.log('✓ 已连接到 MySQL');

  // 读取 init.sql
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');

  // 分隔多条语句执行
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    // 跳过视图创建（需要在 database 上下文中执行）
    if (stmt.includes('VIEW')) continue;
    await conn.query(stmt);
    const preview = stmt.replace(/\s+/g, ' ').substring(0, 60);
    console.log(`  ✓ ${preview}...`);
  }

  // 切到目标数据库，执行视图
  await conn.query(`USE \`${DB_CONFIG.database}\``);
  const viewSQL = sql.substring(sql.indexOf('CREATE OR REPLACE VIEW'));
  await conn.query(viewSQL);
  console.log('  ✓ 视图 best_scores 已创建');

  await conn.end();
  console.log('\n✓ 数据库初始化完成！');
}

init().catch(err => {
  console.error('✗ 初始化失败:', err.message);
  console.error('  请确保 MySQL 已启动，并检查 .env 中的配置');
  process.exit(1);
});
