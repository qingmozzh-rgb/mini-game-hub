/**
 * Mini Game Hub API — 前端注入脚本 v1.0
 * =========================================
 * 功能：登录弹窗 + 成绩提交 + 实时排名弹窗
 *
 * 接入方式：在 index.html 的 </body> 前添加一行：
 *   <script src="game-hub-api.js"></script>
 *
 * 游戏通关时调用：
 *   window.MiniGameHub.submitScore('klotski', 通关秒数)  // 华容道
 *   window.MiniGameHub.submitScore('fruit',   得分)       // 切水果
 */

(function () {
  'use strict';

  // ======================== 配置 ========================
  const API_BASE = 'http://localhost:3000';
  const STORAGE_KEY = 'minigamehub_token';

  // 如果 window.MiniGameHub 不存在就创建
  if (window.MiniGameHub) return; // 防止重复注入

  // ======================== 状态 ========================
  const state = {
    token: null,
    user: null,
    isLoggedIn: false,
    loginModal: null,
    userBar: null,
    overlay: null,
  };

  // ======================== API 请求 ========================
  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);
    return res.json();
  }

  // ======================== 登录 ========================
  async function login(nickname) {
    const res = await api('POST', '/api/login', { nickname });
    if (!res.ok) {
      alert(res.error || '登录失败');
      return false;
    }
    state.token  = res.data.token;
    state.user   = res.data.user;
    state.isLoggedIn = true;
    localStorage.setItem(STORAGE_KEY, state.token);

    // 隐藏登录弹窗
    if (state.loginModal) {
      state.loginModal.remove();
      state.loginModal = null;
    }
    // 显示用户条
    showUserBar();
    return true;
  }

  // ======================== 自动恢复登录 ========================
  async function tryRestore() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;

    state.token = saved;
    const res = await api('GET', '/api/me');
    if (res.ok && res.data && res.data.user) {
      state.user   = res.data.user;
      state.isLoggedIn = true;
      showUserBar();
      return true;
    }
    // Token 过期，清除
    localStorage.removeItem(STORAGE_KEY);
    state.token = null;
    return false;
  }

  // ======================== UI ========================

  // 注入 CSS
  function injectStyles() {
    const css = `
      /* 遮罩 */
      .mgh-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
        animation: mghFadeIn 0.3s ease;
      }
      @keyframes mghFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes mghSlideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      /* 登录框 */
      .mgh-login-box {
        background: #1a1a2e; border-radius: 16px; padding: 36px 32px;
        width: 360px; max-width: 90vw; text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        border: 1px solid #2a2a4a;
        animation: mghSlideUp 0.35s ease;
      }
      .mgh-login-box h2 {
        color: #e0e0ff; margin: 0 0 8px 0; font-size: 24px;
      }
      .mgh-login-box p {
        color: #8888aa; margin: 0 0 24px 0; font-size: 14px;
      }
      .mgh-login-box input {
        width: 100%; padding: 12px 16px; border-radius: 10px;
        border: 2px solid #2a2a4a; background: #0d0d1a;
        color: #e0e0ff; font-size: 16px; outline: none;
        box-sizing: border-box; transition: border-color 0.2s;
      }
      .mgh-login-box input:focus {
        border-color: #6c63ff;
      }
      .mgh-login-box button {
        width: 100%; margin-top: 16px; padding: 12px;
        border-radius: 10px; border: none;
        background: linear-gradient(135deg, #6c63ff, #4a47e0);
        color: #fff; font-size: 16px; font-weight: 600;
        cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
      }
      .mgh-login-box button:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 20px rgba(108,99,255,0.4);
      }

      /* 用户条 */
      .mgh-user-bar {
        position: fixed; top: 16px; right: 16px; z-index: 9998;
        background: #1a1a2ecc; backdrop-filter: blur(10px);
        border: 1px solid #2a2a4a; border-radius: 24px;
        padding: 8px 16px;
        display: flex; align-items: center; gap: 10px;
        color: #e0e0ff; font-size: 14px;
        animation: mghSlideUp 0.3s ease;
      }
      .mgh-user-bar .mgh-avatar {
        width: 28px; height: 28px; border-radius: 50%;
        background: linear-gradient(135deg, #6c63ff, #ff6584);
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: 700; color: #fff;
      }
      .mgh-user-bar .mgh-logout {
        color: #8888aa; cursor: pointer; font-size: 12px;
        background: none; border: none; padding: 4px 8px;
        border-radius: 12px; transition: background 0.2s;
      }
      .mgh-user-bar .mgh-logout:hover {
        background: rgba(255,255,255,0.08); color: #ff6b6b;
      }

      /* 排名弹窗 */
      .mgh-rank-box {
        background: #1a1a2e; border-radius: 16px; padding: 32px;
        width: 400px; max-width: 90vw; text-align: center;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        border: 1px solid #2a2a4a;
        animation: mghSlideUp 0.4s ease;
      }
      .mgh-rank-box .mgh-rank-icon {
        font-size: 52px; margin-bottom: 8px;
      }
      .mgh-rank-box h3 {
        color: #e0e0ff; margin: 0 0 6px 0; font-size: 22px;
      }
      .mgh-rank-box .mgh-rank-score {
        color: #aaaacc; font-size: 16px; margin-bottom: 4px;
      }
      .mgh-rank-box .mgh-rank-number {
        font-size: 64px; font-weight: 800;
        background: linear-gradient(135deg, #ffd700, #ffaa00);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        background-clip: text;
        margin: 12px 0;
      }
      .mgh-rank-box .mgh-rank-of {
        color: #8888aa; font-size: 16px; margin-bottom: 16px;
      }
      .mgh-rank-box .mgh-rank-best {
        color: #7eff7e; font-size: 14px; margin-bottom: 20px;
      }
      .mgh-rank-box button {
        padding: 10px 32px; border-radius: 10px; border: none;
        background: linear-gradient(135deg, #6c63ff, #4a47e0);
        color: #fff; font-size: 16px; font-weight: 600;
        cursor: pointer; transition: transform 0.15s;
      }
      .mgh-rank-box button:hover {
        transform: translateY(-1px);
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // 登录弹窗
  function showLoginModal() {
    const overlay = document.createElement('div');
    overlay.className = 'mgh-overlay';
    overlay.innerHTML = `
      <div class="mgh-login-box">
        <h2>🎮 加入排行榜</h2>
        <p>输入昵称，开始挑战</p>
        <input type="text" class="mgh-nick-input" placeholder="输入你的昵称..." maxlength="30" autofocus>
        <button class="mgh-login-btn">进入游戏</button>
      </div>
    `;
    document.body.appendChild(overlay);
    state.loginModal = overlay;

    const input   = overlay.querySelector('.mgh-nick-input');
    const button  = overlay.querySelector('.mgh-login-btn');

    const doLogin = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      button.disabled = true;
      button.textContent = '登录中...';
      await login(name);
      if (!state.isLoggedIn) {
        button.disabled = false;
        button.textContent = '进入游戏';
      }
    };

    button.addEventListener('click', doLogin);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    input.focus();
  }

  // 用户条
  function showUserBar() {
    if (state.userBar) state.userBar.remove();

    const firstChar = state.user.nickname.charAt(0).toUpperCase();
    const bar = document.createElement('div');
    bar.className = 'mgh-user-bar';
    bar.innerHTML = `
      <div class="mgh-avatar">${firstChar}</div>
      <span>${state.user.nickname}</span>
      <button class="mgh-logout">退出</button>
    `;
    document.body.appendChild(bar);
    state.userBar = bar;

    bar.querySelector('.mgh-logout').addEventListener('click', logout);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    state.token = null;
    state.user  = null;
    state.isLoggedIn = false;
    if (state.userBar) { state.userBar.remove(); state.userBar = null; }
    showLoginModal();
  }

  // 排名弹窗
  function showRankModal(game, result) {
    const { display } = result.data;

    // 排名图标
    let icon = '🏅';
    if (display.rank === 1) icon = '👑';
    else if (display.rank <= 3) icon = '🥈';
    if (display.rank === 3) icon = '🥉';

    const bestMsg = display.isBest
      ? '🎉 新个人最佳成绩！'
      : `个人最佳: ${result.data.personalBest} ${display.unit}`;

    const overlay = document.createElement('div');
    overlay.className = 'mgh-overlay';
    overlay.innerHTML = `
      <div class="mgh-rank-box">
        <div class="mgh-rank-icon">${icon}</div>
        <h3>${display.game}</h3>
        <div class="mgh-rank-score">本次成绩: ${display.score} ${display.unit}</div>
        <div class="mgh-rank-number">#${display.rank}</div>
        <div class="mgh-rank-of">共 ${display.total} 名玩家</div>
        <div class="mgh-rank-best">${bestMsg}</div>
        <button class="mgh-rank-close">知道了</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.mgh-rank-close').addEventListener('click', () => {
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ======================== 核心：提交成绩 ========================
  async function submitScore(game, score) {
    if (!state.isLoggedIn) {
      console.warn('[MiniGameHub] 未登录，无法提交成绩');
      return null;
    }

    try {
      const result = await api('POST', '/api/score', { game, score });
      if (!result.ok) {
        console.error('[MiniGameHub] 提交失败:', result.error);
        return null;
      }

      // 显示排名弹窗
      showRankModal(game, result);
      return result;
    } catch (err) {
      console.error('[MiniGameHub] 网络错误:', err.message);
      return null;
    }
  }

  // ======================== 暴露 API ========================
  window.MiniGameHub = {
    submitScore,
    getUser: () => state.user,
    isLoggedIn: () => state.isLoggedIn,
    login,
    logout,
  };

  // ======================== 初始化 ========================
  async function init() {
    injectStyles();

    // 尝试恢复登录
    const restored = await tryRestore();

    if (!restored) {
      // 显示登录弹窗
      showLoginModal();
    }
  }

  // DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
