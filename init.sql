-- Mini Game Hub 数据库初始化脚本
-- 用法: mysql -u root -p < init.sql

CREATE DATABASE IF NOT EXISTS mini_game_hub
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE mini_game_hub;

-- 用户表：昵称唯一，无密码
CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  nickname   VARCHAR(30)  NOT NULL UNIQUE,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_nickname (nickname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 成绩表：每个用户每个游戏可多次提交，保留历史
CREATE TABLE IF NOT EXISTS scores (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  game_name   VARCHAR(50)  NOT NULL COMMENT 'klotski=华容道, fruit=切水果',
  score_value FLOAT        NOT NULL COMMENT '华容道存秒数(越小越好), 切水果存得分(越大越好)',
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_game_score (game_name, score_value),
  INDEX idx_user_game (user_id, game_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 视图：每个用户每个游戏的最佳成绩
CREATE OR REPLACE VIEW best_scores AS
SELECT
  s.user_id,
  u.nickname,
  s.game_name,
  CASE
    WHEN s.game_name = 'klotski' THEN MIN(s.score_value)   -- 华容道取最短时间
    WHEN s.game_name = 'fruit'   THEN MAX(s.score_value)   -- 切水果取最高分
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
GROUP BY s.user_id, u.nickname, s.game_name;
