/**
 * Mini Game Hub 后端服务
 * - 昵称登录（无密码）
 * - 成绩提交 + 排名查询
 * - 排行榜
 */
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const mysql    = require('mysql2/promise');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');

// ======================== 配置 ========================
const CONFIG = {
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'mini_game_hub',
};

const PORT = parseInt(process.env.PORT) || 3000;

// 游戏配置
const GAMES = {
  klotski: { name: '华容道', order: 'ASC',  label: '通关时间', unit: '秒' },
  fruit:   { name: '切水果', order: 'DESC', label: '得分',     unit: '分' },
};

// ======================== 数据库连接池 ========================
const pool = mysql.createPool({
  ...CONFIG,
  charset:          'utf8mb4',
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
  enableKeepAlive:  true,
  keepAliveInitialDelay: 0,
});

// ======================== Token 管理（简单内存版） ========================
const tokens = new Map(); // token -> { userId, nickname, expires }

function createToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, {
    userId:   user.id,
    nickname: user.nickname,
    expires:  Date.now() + 24 * 60 * 60 * 1000, // 24小时过期
  });
  return token;
}

function getUserByToken(token) {
  const entry = tokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    tokens.delete(token);
    return null;
  }
  return entry;
}

// 定期清理过期 token
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokens) {
    if (now > v.expires) tokens.delete(k);
  }
}, 60 * 60 * 1000);

// ======================== Express ========================
const app = express();
app.use(cors());
app.use(express.json());

// 静态文件（前端页面可直接放到 public 目录）
app.use(express.static(path.join(__dirname, 'public')));

// ======================== API 路由 ========================

/**
 * POST /api/login
 * Body: { nickname: "子皓" }
 * 返回: token + user 信息
 */
app.post('/api/login', async (req, res) => {
  try {
    const { nickname } = req.body;

    if (!nickname || typeof nickname !== 'string') {
      return res.status(400).json({ ok: false, error: '请提供昵称' });
    }

    const name = nickname.trim();
    if (name.length < 1 || name.length > 30) {
      return res.status(400).json({ ok: false, error: '昵称长度需在 1-30 个字符之间' });
    }

    // 查找或创建用户
    let [rows] = await pool.query('SELECT id, nickname, created_at FROM users WHERE nickname = ?', [name]);

    let user;
    if (rows.length === 0) {
      // 新用户，注册
      const [result] = await pool.query('INSERT INTO users (nickname) VALUES (?)', [name]);
      user = { id: result.insertId, nickname: name };
    } else {
      user = rows[0];
    }

    const token = createToken(user);

    res.json({
      ok: true,
      data: {
        token,
        user: { id: user.id, nickname: user.nickname },
      }
    });
  } catch (err) {
    console.error('POST /api/login error:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

/**
 * POST /api/score
 * Headers: Authorization: Bearer <token>
 * Body: { game: "klotski" | "fruit", score: 数值 }
 * 返回: 该成绩在游戏中的排名 + 是否刷新个人最佳
 */
app.post('/api/score', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const { game, score } = req.body;

    // 鉴权
    const auth = getUserByToken(token);
    if (!auth) {
      return res.status(401).json({ ok: false, error: '未登录，请先输入昵称' });
    }

    // 参数校验
    if (!game || !GAMES[game]) {
      return res.status(400).json({ ok: false, error: '无效的游戏名称，支持: klotski, fruit' });
    }

    const gameCfg = GAMES[game];
    if (typeof score !== 'number' || score < 0) {
      return res.status(400).json({ ok: false, error: `分数必须是正数` });
    }

    // 华容道：时间不能为0
    if (game === 'klotski' && score === 0) {
      return res.status(400).json({ ok: false, error: '通关时间必须大于 0' });
    }

    // 查历史最佳
    const [oldRows] = await pool.query(
      `SELECT best_score FROM best_scores WHERE user_id = ? AND game_name = ?`,
      [auth.userId, game]
    );

    const oldBest = oldRows.length > 0 ? oldRows[0].best_score : null;
    const isNewBest = oldBest === null || (
      gameCfg.order === 'ASC'  ? score < oldBest :   // 华容道：时间更短
                                  score > oldBest     // 切水果：分数更高
    );

    // 插入成绩
    await pool.query(
      'INSERT INTO scores (user_id, game_name, score_value) VALUES (?, ?, ?)',
      [auth.userId, game, score]
    );

    // 查当前最佳
    const [bestRows] = await pool.query(
      `SELECT best_score FROM best_scores WHERE user_id = ? AND game_name = ?`,
      [auth.userId, game]
    );
    const currentBest = bestRows[0].best_score;

    // 计算排名
    const rank = await getRank(auth.userId, game);
    const totalPlayers = await getTotalPlayers(game);

    res.json({
      ok: true,
      data: {
        isNewBest,
        personalBest: currentBest,
        rank,
        totalPlayers,
        // 用于弹窗显示的格式化信息
        display: {
          game:  gameCfg.name,
          score: score,
          unit:  gameCfg.unit,
          rank:  rank,
          total: totalPlayers,
          isBest: isNewBest,
        }
      }
    });
  } catch (err) {
    console.error('POST /api/score error:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

/**
 * GET /api/leaderboard/:game
 * Query: ?limit=10 （可选，默认 20）
 * 返回: 排行榜
 */
app.get('/api/leaderboard/:game', async (req, res) => {
  try {
    const { game } = req.params;
    if (!GAMES[game]) {
      return res.status(400).json({ ok: false, error: '无效的游戏名称' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const gameCfg = GAMES[game];

    // 从 best_scores 视图查排行榜
    const [rows] = await pool.query(
      `SELECT
        bs.nickname,
        bs.best_score AS score,
        bs.achieved_at
       FROM best_scores bs
       WHERE bs.game_name = ?
       ORDER BY bs.best_score ${gameCfg.order}
       LIMIT ?`,
      [game, limit]
    );

    // 附加排名序号
    const leaderboard = rows.map((row, i) => ({
      rank:     i + 1,
      nickname: row.nickname,
      score:    row.score,
      unit:     gameCfg.unit,
      achieved_at: row.achieved_at,
    }));

    res.json({ ok: true, data: { game: gameCfg.name, unit: gameCfg.unit, leaderboard } });
  } catch (err) {
    console.error('GET /api/leaderboard error:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

/**
 * GET /api/rank/:userId/:game
 * 查某个用户的排名
 */
app.get('/api/rank/:userId/:game', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { game } = req.params;

    if (!GAMES[game]) {
      return res.status(400).json({ ok: false, error: '无效的游戏名称' });
    }

    const rank = await getRank(userId, game);
    const total = await getTotalPlayers(game);

    const [bestRows] = await pool.query(
      `SELECT best_score, achieved_at FROM best_scores WHERE user_id = ? AND game_name = ?`,
      [userId, game]
    );

    if (bestRows.length === 0) {
      return res.json({ ok: true, data: { hasPlayed: false, rank: null, totalPlayers: total } });
    }

    res.json({
      ok: true,
      data: {
        hasPlayed: true,
        rank,
        totalPlayers: total,
        bestScore: bestRows[0].best_score,
        unit: GAMES[game].unit,
        achievedAt: bestRows[0].achieved_at,
      }
    });
  } catch (err) {
    console.error('GET /api/rank error:', err);
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

/**
 * GET /api/me
 * 获取当前登录用户信息
 */
app.get('/api/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const auth = getUserByToken(token);
    if (!auth) {
      return res.json({ ok: true, data: null });
    }

    res.json({
      ok: true,
      data: {
        user: { id: auth.userId, nickname: auth.nickname },
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: '服务器错误' });
  }
});

// ======================== 辅助函数 ========================

async function getRank(userId, game) {
  const gameCfg = GAMES[game];
  // 获取该用户的最佳成绩
  const [bestRows] = await pool.query(
    `SELECT best_score FROM best_scores WHERE user_id = ? AND game_name = ?`,
    [userId, game]
  );
  if (bestRows.length === 0) return null;

  const bestScore = bestRows[0].best_score;

  // 计算有多少人比 TA 强
  const operator = gameCfg.order === 'ASC' ? '<' : '>';
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM best_scores WHERE game_name = ? AND best_score ${operator} ?`,
    [game, bestScore]
  );

  return countRows[0].cnt + 1; // 排名从 1 开始
}

async function getTotalPlayers(game) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM best_scores WHERE game_name = ?',
    [game]
  );
  return rows[0].cnt;
}

// ======================== 自动初始化数据库 ========================
async function autoInitDB() {
  // 先不指定数据库，连接 MySQL
  const initConn = await mysql.createConnection({
    host:     CONFIG.host,
    port:     CONFIG.port,
    user:     CONFIG.user,
    password: CONFIG.password,
    multipleStatements: true,
  });

  // 创建数据库
  await initConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${CONFIG.database}\`
     DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
  );
  console.log(`  ✓ 数据库 ${CONFIG.database} 就绪`);

  // 切到目标数据库
  await initConn.query(`USE \`${CONFIG.database}\``);

  // 建表
  await initConn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      nickname   VARCHAR(30)  NOT NULL UNIQUE,
      created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_nickname (nickname)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✓ 表 users 就绪');

  await initConn.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT          NOT NULL,
      game_name   VARCHAR(50)  NOT NULL,
      score_value FLOAT        NOT NULL,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_game_score (game_name, score_value),
      INDEX idx_user_game (user_id, game_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✓ 表 scores 就绪');

  // 创建/刷新视图
  await initConn.query(`
    CREATE OR REPLACE VIEW best_scores AS
    SELECT
      s.user_id,
      u.nickname,
      s.game_name,
      CASE
        WHEN s.game_name = 'klotski' THEN MIN(s.score_value)
        WHEN s.game_name = 'fruit'   THEN MAX(s.score_value)
      END AS best_score,
      CASE
        WHEN s.game_name = 'klotski' THEN (
          SELECT s2.created_at FROM scores s2
          WHERE s2.user_id = s.user_id AND s2.game_name = s.game_name
            AND s2.score_value = MIN(s.score_value)
          ORDER BY s2.created_at ASC LIMIT 1
        )
        WHEN s.game_name = 'fruit' THEN (
          SELECT s2.created_at FROM scores s2
          WHERE s2.user_id = s.user_id AND s2.game_name = s.game_name
            AND s2.score_value = MAX(s.score_value)
          ORDER BY s2.created_at ASC LIMIT 1
        )
      END AS achieved_at
    FROM scores s
    JOIN users u ON u.id = s.user_id
    GROUP BY s.user_id, u.nickname, s.game_name
  `);
  console.log('  ✓ 视图 best_scores 就绪');

  await initConn.end();
}

// ======================== 启动 ========================
(async () => {
  try {
    await autoInitDB();
    console.log('');
  } catch (err) {
    console.error('⚠ 数据库初始化失败:', err.message);
    console.error('  请确保 MySQL 已启动并检查 .env 配置');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`
  ╔════════════════════════════════════════╗
  ║   🎮 Mini Game Hub 后端已启动          ║
  ║   地址: http://localhost:${PORT}          ║
  ║   登录: POST /api/login                ║
  ║   成绩: POST /api/score                ║
  ║   排行: GET  /api/leaderboard/:game    ║
  ╚════════════════════════════════════════╝
    `);
  });
})();
