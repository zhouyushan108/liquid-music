/* ============================================================
   开源音乐 · 前端逻辑
   - 双模式 API：Web → /api 后端；Capacitor → 直连冈易（CapacitorHttp）
   - 可拖拽液态玻璃实时调节器（持久化）
   - 界面密度（紧凑/标准/宽松）
   ============================================================ */
function _h(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h)+s.charCodeAt(i);return(h>>>0).toString(16)}
let _antiReverse=false;
function _applyAntiReverse(){
  if(!_antiReverse)return;
  setInterval(()=>{
    if(_shazamRecording)return;
    const t=performance.now();
    (function(){}).constructor('debugger')();
    if(performance.now()-t>500){console.clear();}
  },4000);
}

/* ---------- Capacitor 检测 ---------- */
const isCapacitorNative = (() => {
  try {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  } catch (e) { return false; }
})();
const CapacitorHttp = (isCapacitorNative && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp) ? window.Capacitor.Plugins.CapacitorHttp : null;

/* ---------- NetEase 直连常量（Capacitor 模式） ---------- */
const NE_HOST = 'https://music.163.com';
const NE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://music.163.com',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};
const NE_CHART_IDS = { hot: 3778678, new: 3779629, rise: 19723756, origin: 2884035 };

/* 规整为 songInfo（与 server.js normalizeSong 完全一致） */
function normalizeSong(s) {
  if (!s) return null;
  const album = s.album || s.al || {};
  const artists = s.artists || s.ar || [];
  return {
    songId: s.id,
    name: s.name || '',
    album: {
      id: album.id,
      name: album.name || '',
      cover: album.picUrl || album.pic_str || (album.picId ? `https://p1.music.126.net/${album.picId}.jpg` : '')
    },
    artists: artists.map((a) => ({ id: a.id, name: a.name || '' })),
    duration: s.duration || s.dt || 0,
    vendor: 'netease'
  };
}

/* ============================================================
   API 客户端（双模式）
   ============================================================ */
const api = {
  async webGet(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('请求失败 ' + r.status);
    return r.json();
  },
  async nativeRequest(options) {
    if (!CapacitorHttp) throw new Error('CapacitorHttp 不可用');
    const res = await CapacitorHttp.request({
      method: options.method || 'GET',
      url: options.url,
      headers: { ...NE_HEADERS, ...(options.headers || {}) },
      data: options.data || undefined
    });
    let body = res.data;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { /* keep string */ }
    }
    if (!body) body = {};
    return body;
  },

  async search(keyword, limit = 30, page = 1) {
    if (isCapacitorNative) {
      const offset = (Math.max(1, page) - 1) * limit;
      const json = await this.nativeRequest({
        method: 'POST',
        url: NE_HOST + '/api/search/pc',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: { s: keyword, type: 1, offset, limit }
      });
      const list = (json.result && json.result.songs) || [];
      return { total: (json.result && json.result.songCount) || list.length, songs: list.map(normalizeSong) };
    }
    return this.webGet(`/api/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}&page=${page}`);
  },

  async songDetail(ids) {
    if (isCapacitorNative) {
      const json = await this.nativeRequest({ url: NE_HOST + `/api/song/detail/?ids=[${ids.join(',')}]` });
      return { songs: (json.songs || []).map(normalizeSong) };
    }
    return this.webGet(`/api/song/detail?ids=${ids.join(',')}`);
  },

  songUrl(id) {
    // Web 与 Capacitor 通用：音频元素 src 不受 CORS 限制
    return { url: `https://music.163.com/song/media/outer/url?id=${id}.mp3` };
  },

  async playlist(id) {
    if (isCapacitorNative) {
      const json = await this.nativeRequest({ url: NE_HOST + `/api/playlist/detail?id=${id}` });
      const result = json.result || json.playlist || {};
      const tracks = result.tracks || [];
      return {
        id,
        name: result.name || '',
        cover: result.coverImgUrl || result.picUrl || '',
        description: result.description || '',
        songs: tracks.map(normalizeSong)
      };
    }
    return this.webGet(`/api/playlist/detail?id=${id}`);
  },

  async topPlaylists(limit = 12) {
    if (isCapacitorNative) {
      const json = await this.nativeRequest({ url: NE_HOST + `/api/playlist/list?cat=%E5%85%A8%E9%83%A8&order=hot&limit=${limit}&offset=0` });
      const list = json.playlists || [];
      return { playlists: list.map((p) => ({ id: p.id, name: p.name, cover: p.coverImgUrl || p.picUrl || '', playCount: p.playCount || 0, trackCount: p.trackCount || 0 })) };
    }
    return this.webGet(`/api/playlist/top?limit=${limit}`);
  },

  async chart(type) {
    if (isCapacitorNative) {
      const id = NE_CHART_IDS[type] || NE_CHART_IDS.hot;
      return this.playlist(id);
    }
    return this.webGet(`/api/chart?type=${type}`);
  },

  async lyric(id) {
    if (isCapacitorNative) {
      const json = await this.nativeRequest({ url: NE_HOST + `/api/song/lyric?os=pc&id=${id}&lv=-1&kv=-1&tv=-1` });
      return {
        lyric: (json.lrc && json.lrc.lyric) || '',
        tlyric: (json.tlyric && json.tlyric.lyric) || ''
      };
    }
    return this.webGet(`/api/lyric?id=${id}`);
  }
};

/* ============================================================
   音频 URL 解析
   - Web 模式：直接用 outer URL（浏览器能跟随重定向+正确 UA）
   - Capacitor 模式：WebView 的请求头不对会被重定向到 404 页面，
     必须用 CapacitorHttp 带正确 UA/Referer 下载 mp3 → 转 blob URL
   - 多平台：网易直接用 outer URL；酷狗/QQ 走后端 /api/song/url 解析
   ============================================================ */
async function downloadAudioBlob(url, headers = NE_HEADERS) {
  try {
    const res = await CapacitorHttp.request({ method: 'GET', url, headers });
    if (!res || !res.data) return url;
    // CapacitorHttp 默认返回 base64 字符串
    let base64 = res.data;
    if (typeof base64 !== 'string') return url;
    // 去掉可能的 data: 前缀
    if (base64.startsWith('data:')) {
      base64 = base64.substring(base64.indexOf(',') + 1);
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.length < 4) return url;
    // 检查是否真的是音频（ID3/MP3 帧同步/m4a ftyp 盒）
    const isAudio = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || // "ID3"
                    (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) ||              // MP3 帧同步
                    (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70); // "ftyp"
    if (!isAudio) {
      console.warn('downloadAudioBlob: 响应不是音频，可能是错误页面，size=', bytes.length);
      return url;
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('downloadAudioBlob error, fallback:', e && e.message);
    return url;
  }
}

async function resolveAudioUrl(song) {
  // 兼容旧的 songId 入参
  const vendor = (song && song.vendor) || 'netease';
  const songId = (song && song.songId) || song;

  // 非网易平台：通过后端 /api/song/url 解析（带 vendor/albumId 参数）
  if (vendor !== 'netease') {
    const params = new URLSearchParams({ id: String(songId), vendor });
    if (song && song.name) params.set('name', song.name);
    if (song && song.album && song.album.id) params.set('albumId', String(song.album.id));
    try {
      const r = await fetch(`/api/song/url?${params}`);
      const d = await r.json();
      const url = d && d.url;
      if (!url) return '';
      if (!isCapacitorNative) return url;
      return await downloadAudioBlob(url);
    } catch (e) {
      console.warn('resolveAudioUrl error:', e && e.message);
      return '';
    }
  }

  // 网易云：outer URL
  const originalUrl = `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
  if (!isCapacitorNative) return originalUrl;
  try {
    const res = await CapacitorHttp.request({
      method: 'GET',
      url: originalUrl,
      headers: NE_HEADERS
    });
    if (!res || !res.data) return originalUrl;
    // CapacitorHttp 默认返回 base64 字符串
    let base64 = res.data;
    if (typeof base64 !== 'string') return originalUrl;
    // 去掉可能的 data: 前缀
    if (base64.startsWith('data:')) {
      base64 = base64.substring(base64.indexOf(',') + 1);
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    // 检查是否真的是 mp3（ID3 标签或 MP3 帧同步）
    if (bytes.length < 4) return originalUrl;
    const isMp3 = (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || // "ID3"
                  (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0);                // 帧同步
    if (!isMp3) {
      console.warn('resolveAudioUrl: 响应不是 mp3，可能是 404 页面，size=', bytes.length);
      return originalUrl;
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('resolveAudioUrl error, fallback:', e && e.message);
    return originalUrl;
  }
}

/* ============================================================
   工具函数
   ============================================================ */
const $ = (s) => document.querySelector(s);
const fmtTime = (ms) => {
  const s = Math.floor((ms || 0) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
const fmtCount = (n) => {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n || 0);
};
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const songKey = (s) => `${s.vendor}:${s.songId}`;
const artistsText = (s) => (s.artists && s.artists.length ? s.artists.map((a) => a.name).join(' / ') : '未知');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* 封面加载失败占位图 */
const COVER_FALLBACK = 'data:image/svg+xml,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#3a3a6c'/><stop offset='1' stop-color='#15151f'/></linearGradient></defs><rect width='80' height='80' fill='url(#g)'/><path d='M52 20v24a9 9 0 1 1-5-8V28l-13 3v17a9 9 0 1 1-5-8V24z' fill='rgba(255,255,255,0.42)'/></svg>"
);
window.coverFallback = (img) => { img.onerror = null; img.src = COVER_FALLBACK; };
const coverSrc = (url) => (url && url.trim()) ? url : COVER_FALLBACK;

/* ============================================================
   设置（含液态参数 / 密度 / VIP）
   ============================================================ */
/* ACRCloud 默认凭证（听歌识曲） */
const ACR_DEFAULT_ACCESS_KEY = '7c0a26b28999abf5cb80fb2830e6d3c9';
const ACR_DEFAULT_ACCESS_SECRET = 'mV2lxnAWzijHeDobVcwSYiEtVJwxkvuomtlszjcq';

const DEFAULT_SETTINGS = {
  transitions: true,
  bgAnimation: true,
  pageAnimation: 'fade',
  density: 'normal',          // compact | normal | comfortable
  background: { mode: 'theme', theme: 'default', color: '#0a0a1a' },  // mode: theme|color
  liquid: { blur: 28, opacity: 40, spec: 55, refract: 14, hue: null }  // 模糊/透明度0~100/高光0~100/折射0~30/色相0~360(null=默认)
};
function loadSettings() {
  try { return JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('lm_settings') || '{}') })); }
  catch (e) { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); }
}
function saveSettings() { localStorage.setItem('lm_settings', JSON.stringify(state.settings)); }

function applySettings() {
  document.documentElement.classList.toggle('no-transitions', !state.settings.transitions);
  document.documentElement.classList.toggle('no-bg-anim', !state.settings.bgAnimation);
  // 密度
  document.documentElement.classList.remove('density-compact', 'density-normal', 'density-comfortable');
  document.documentElement.classList.add('density-' + (state.settings.density || 'normal'));
  // VIP
  document.documentElement.classList.toggle('vip', state.vip);
  // 液态参数
  applyLiquid();
  // 背景
  applyBackground();
}

/* 背景主题 / 纯色模式 */
function applyBackground() {
  const bg = state.settings.background || DEFAULT_SETTINGS.background;
  const root = document.documentElement;
  if (bg.mode === 'color') {
    root.classList.add('bg-solid');
    root.style.setProperty('--bg-solid', bg.color || '#0a0a1a');
    root.removeAttribute('data-bg-theme');
  } else {
    root.classList.remove('bg-solid');
    root.style.removeProperty('--bg-solid');
    if (bg.theme && bg.theme !== 'default') {
      root.setAttribute('data-bg-theme', bg.theme);
    } else {
      root.removeAttribute('data-bg-theme');
    }
  }
}

function applyLiquid() {
  const l = state.settings.liquid || DEFAULT_SETTINGS.liquid;
  const root = document.documentElement.style;
  root.setProperty('--glass-blur', l.blur + 'px');
  root.setProperty('--glass-opacity', (l.opacity / 100).toFixed(2));
  root.setProperty('--glass-spec', (l.spec / 100).toFixed(2));
  root.setProperty('--liquid-scale', String(l.refract ?? 14));
  applyHue();
}

/* 主色调 hue 调节：null=跟随主题（VIP 优先），0-360=覆盖 --accent */
function applyHue() {
  const root = document.documentElement.style;
  const l = state.settings.liquid || DEFAULT_SETTINGS.liquid;
  const hue = l.hue;
  // VIP 主题优先：开启 VIP 时清空内联色，让 html.vip 的金色生效
  if (state.vip || hue === null || hue === undefined || isNaN(hue)) {
    root.removeProperty('--accent');
    root.removeProperty('--accent-2');
    root.removeProperty('--accent-grad');
    return;
  }
  const h = ((hue % 360) + 360) % 360;
  const h2 = (h + 40) % 360;
  root.setProperty('--accent', `hsl(${h}, 85%, 70%)`);
  root.setProperty('--accent-2', `hsl(${h2}, 80%, 72%)`);
  root.setProperty('--accent-grad', `linear-gradient(135deg, hsl(${h}, 85%, 70%), hsl(${h2}, 80%, 72%))`);
}

/* VIP 状态 */
function loadVip() { return localStorage.getItem('lm_vip') === '1'; }
function setVip(on) {
  state.vip = on;
  localStorage.setItem('lm_vip', on ? '1' : '0');
  document.documentElement.classList.toggle('vip', on);
  applyHue(); // VIP 切换需重新计算 hue 覆盖
}

/* ADMIN 状态（admin1 解锁） */
function loadAdmin() { return localStorage.getItem('lm_admin') === '1'; }
function setAdmin(on) {
  state.admin = on;
  localStorage.setItem('lm_admin', on ? '1' : '0');
  document.documentElement.classList.toggle('admin', on);
  const ab = document.getElementById('adminNavBtn');
  if (ab) ab.hidden = !on;
  const at = document.getElementById('adminTag');
  if (at) at.hidden = !on;
  // admin 按钮显隐改变导航布局，延迟一帧更新指示器位置
  requestAnimationFrame(() => updateNavIndicator());
}

/* ============================================================
   状态
   ============================================================ */
const state = {
  page: 'home',
  queue: [],
  currentIndex: -1,
  playing: false,
  repeat: 'off',
  shuffle: false,
  likes: loadLikes(),
  settings: loadSettings(),
  vip: loadVip(),
  admin: loadAdmin(),
  history: [],
  lyrics: [],
  tlyric: [],
  cache: { playlists: null, charts: {} },
  adjusterPos: null,
  deferredPrompt: null
};

function loadLikes() {
  try { return JSON.parse(localStorage.getItem('lm_likes') || '[]'); } catch (e) { return []; }
}
function saveLikes() {
  localStorage.setItem('lm_likes', JSON.stringify(state.likes));
  updateLikesBadge();
}
/** 仅刷新红点 UI，不写入 localStorage（避免启动时误覆盖） */
function updateLikesBadge() {
  const badge = $('#likesBadge');
  if (!badge) return;
  if (state.likes.length) { badge.hidden = false; badge.textContent = state.likes.length; }
  else badge.hidden = true;
}
function isLiked(song) { return state.likes.some((s) => songKey(s) === songKey(song)); }
function toggleLike(song) {
  const i = state.likes.findIndex((s) => songKey(s) === songKey(song));
  if (i >= 0) { state.likes.splice(i, 1); toast('已取消喜欢'); }
  else { state.likes.unshift(song); toast('已加入喜欢'); }
  saveLikes();
  document.querySelectorAll(`[data-like="${songKey(song)}"]`).forEach((el) => el.classList.toggle('liked', isLiked(song)));
  if (state.page === 'likes') renderLikes();
}

/* ---------- DOM 引用 ---------- */
const audio = $('#audio');
const pageEl = $('#page');
const pageTitle = $('#pageTitle');

/* ============================================================
   路由 / 页面切换
   ============================================================ */
function setPage(name, opts = {}) {
  state.page = name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  const titles = { home: '首页', recommend: '推荐', search: '搜索', likes: '我的喜欢', settings: '设置', playlist: '歌单详情', admin: '管理后台' };
  pageTitle.textContent = opts.title || titles[name] || '';
  $('#backBtn').style.display = state.history.length ? '' : 'none';
  pageEl.scrollTop = 0;
  if (name === 'home') renderHome();
  else if (name === 'recommend') renderRecommend();
  else if (name === 'search') renderSearch(opts);
  else if (name === 'likes') renderLikes();
  else if (name === 'settings') renderSettings();
  else if (name === 'playlist') renderPlaylistDetail(opts);
  else if (name === 'admin') { if (state.admin) renderAdmin(); else { toast('请先在设置中输入解锁码 admin1'); setPage('settings'); } }
  updateNavIndicator();
  applyPageAnim();
}

/* 导航滑动指示器：高亮背景从上一个 nav-item 滑到新激活的 nav-item 位置 */
let _navIndicatorInited = false;
function updateNavIndicator() {
  const nav = document.querySelector('.nav');
  const indicator = document.getElementById('navIndicator');
  if (!nav || !indicator) return;
  const active = nav.querySelector('.nav-item.active');
  // 无激活项（如听歌识曲 overlay 打开）→ 隐藏指示器
  if (!active || active.hidden || active.offsetParent === null) {
    indicator.style.opacity = '0';
    return;
  }
  // 首次定位时不动画，避免页面加载时指示器从 (0,0) 滑入
  if (!_navIndicatorInited) {
    indicator.style.transition = 'none';
  }
  indicator.style.left = active.offsetLeft + 'px';
  indicator.style.top = active.offsetTop + 'px';
  indicator.style.width = active.offsetWidth + 'px';
  indicator.style.height = active.offsetHeight + 'px';
  indicator.style.opacity = '1';
  if (!_navIndicatorInited) {
    void indicator.offsetWidth; // 强制 reflow
    indicator.style.transition = '';
    _navIndicatorInited = true;
  }
}

function applyPageAnim() {
  const anim = state.settings.pageAnimation;
  pageEl.classList.remove('page-anim-fade', 'page-anim-slide');
  if (anim === 'none') return;
  void pageEl.offsetWidth;
  pageEl.classList.add('page-anim-' + anim);
}

function go(name, opts) { state.history.push({ name, opts }); setPage(name, opts); }
function back() {
  if (!state.history.length) return;
  state.history.pop();
  const prev = state.history[state.history.length - 1];
  if (prev) setPage(prev.name, prev.opts);
  else setPage('home');
}

/* ============================================================
   通用 HTML 片段
   ============================================================ */
function songRowHTML(song, index) {
  const key = songKey(song);
  const liked = isLiked(song);
  const cover = coverSrc(song.album && song.album.cover);
  const v = song.vendor || 'netease';
  const vLabel = v === 'kugou' ? '酷狗' : v === 'qq' ? 'QQ' : '网易';
  return `
    <div class="song-row" data-key="${key}" data-index="${index}">
      <div class="idx">${index + 1}</div>
      <img class="cover" src="${cover}" alt="" loading="lazy" onerror="coverFallback(this)">
      <div class="meta">
        <div class="name"><span class="vendor-badge vendor-${v}" title="${esc(v)}">${vLabel}</span>${esc(song.name)}</div>
        <div class="artist">${esc(artistsText(song))}${song.album && song.album.name ? ' · ' + esc(song.album.name) : ''}</div>
      </div>
      <div class="dur">${fmtTime(song.duration)}</div>
      <div class="row-acts">
        <button class="icon-btn like-btn ${liked ? 'liked' : ''}" data-like="${key}" title="喜欢">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
        </button>
      </div>
    </div>`;
}

function bindSongRows(container, songs) {
  container.querySelectorAll('.song-row').forEach((row) => {
    const idx = parseInt(row.dataset.index, 10);
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-like]')) return;
      playQueue(songs.slice(), idx);
    });
  });
  container.querySelectorAll('[data-like]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.like;
      const song = songs.find((s) => songKey(s) === key);
      if (song) toggleLike(song);
    });
  });
  highlightPlayingRow(container);
}

function highlightPlayingRow(container = pageEl) {
  const cur = state.currentIndex >= 0 ? state.queue[state.currentIndex] : null;
  container.querySelectorAll('.song-row').forEach((row) => {
    const isCur = cur && row.dataset.key === songKey(cur);
    row.classList.toggle('playing', isCur);
    const idxEl = row.querySelector('.idx');
    if (isCur) {
      if (state.playing) idxEl.innerHTML = '<span class="eq"><span></span><span></span><span></span><span></span></span>';
    } else {
      idxEl.textContent = parseInt(row.dataset.index, 10) + 1;
    }
  });
}

function loadingHTML(text = '加载中…') {
  return `<div class="loading"><div class="spinner"></div><div>${text}</div></div>`;
}
function emptyHTML(text = '空空如也') {
  return `<div class="empty">${esc(text)}</div>`;
}

/* ============================================================
   首页
   ============================================================ */

/** 随便听听：从多个榜单各随机抽几首，打乱后开始随机播放 */
async function randomPlay() {
  const btn = $('#randomPlayBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  toast('正在为你挑选歌曲…');
  const types = ['hot', 'rise', 'new', 'origin'];
  // 并行加载所有榜单
  await Promise.all(types.map(async (t) => {
    if (!state.cache.charts[t]) {
      try { state.cache.charts[t] = (await api.chart(t)).songs || []; } catch (e) {}
    }
  }));
  // 每个榜单随机抽 3 首，合并去重
  const picked = [];
  const seen = new Set();
  for (const t of types) {
    const songs = (state.cache.charts[t] || []).slice();
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j], songs[i]];
    }
    for (const s of songs.slice(0, 3)) {
      const k = songKey(s);
      if (!seen.has(k)) { seen.add(k); picked.push(s); }
    }
  }
  if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  if (!picked.length) { toast('暂无可播放的歌曲'); return; }
  // 再次打乱
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  // 开启随机模式
  state.shuffle = true;
  const sb = $('#shuffleBtn');
  if (sb) sb.classList.add('active');
  playQueue(picked, 0);
  toast(`已为你挑选 ${picked.length} 首歌，开始播放 🎵`);
}

async function renderHome() {
  pageTitle.textContent = '首页';
  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  pageEl.innerHTML = `
    <div class="search-hero">
      <h2 style="font-size:26px;font-weight:800">${greet}，来听点音乐 🎧</h2>
      <p style="color:var(--text-dim);margin-top:6px;font-size:14px">在液态玻璃中，感受声音的流动。</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">
        <button class="random-play-btn glass-soft" id="randomPlayBtn">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" /></svg>
          <span>随便听听 · 选择困难症救星</span>
        </button>
        <button class="random-play-btn glass-soft" id="homeShazamBtn">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10" /><path d="M12 22a10 10 0 0 1-10-10" /><path d="M12 6v12a6 6 0 0 1-6-6" /><circle cx="12" cy="12" r="2" /></svg>
          <span>听歌识曲</span>
        </button>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h2>精选歌单</h2></div>
      <div id="homePlaylists">${loadingHTML()}</div>
    </div>
    <div class="section">
      <div class="section-head"><h2>热歌榜 · 即刻聆听</h2>
        <button class="more" data-chart="hot">查看全部 ›</button></div>
      <div id="homeHot">${loadingHTML()}</div>
    </div>`;

  $('#randomPlayBtn').addEventListener('click', randomPlay);
  $('#homeShazamBtn')?.addEventListener('click', openShazam);

  (async () => {
    try {
      if (!state.cache.playlists) state.cache.playlists = (await api.topPlaylists(10)).playlists || [];
      const el = $('#homePlaylists');
      if (!state.cache.playlists.length) { el.innerHTML = emptyHTML('暂无歌单'); return; }
      el.innerHTML = `<div class="grid-playlist">${state.cache.playlists.map((p) => `
        <div class="pl-card" data-pl="${p.id}">
          <div class="pl-cover">
            <img src="${coverSrc(p.cover)}" alt="" loading="lazy" onerror="coverFallback(this)">
            <button class="play-fab" data-pl-play="${p.id}">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
          <div class="pl-meta">
            <div class="pl-name">${esc(p.name)}</div>
            <div class="pl-count">${fmtCount(p.playCount)} 播放</div>
          </div>
        </div>`).join('')}</div>`;
      el.querySelectorAll('[data-pl]').forEach((c) => c.addEventListener('click', () => go('playlist', { id: c.dataset.pl })));
    } catch (e) { $('#homePlaylists').innerHTML = emptyHTML('歌单加载失败'); }
  })();

  (async () => {
    try {
      if (!state.cache.charts.hot) state.cache.charts.hot = (await api.chart('hot')).songs || [];
      const el = $('#homeHot');
      const songs = state.cache.charts.hot.slice(0, 8);
      if (!songs.length) { el.innerHTML = emptyHTML('暂无数据'); return; }
      el.innerHTML = `<div class="song-list">${songs.map((s, i) => songRowHTML(s, i)).join('')}</div>`;
      bindSongRows(el, songs);
    } catch (e) { $('#homeHot').innerHTML = emptyHTML('榜单加载失败'); }
  })();

  pageEl.querySelector('[data-chart="hot"]')?.addEventListener('click', () => go('playlist', { id: '3778678', title: '云音乐热歌榜' }));
}

/* ============================================================
   推荐页
   ============================================================ */
const CHARTS = [
  { type: 'rise', name: '云音乐飙升榜', id: '19723756' },
  { type: 'new', name: '云音乐新歌榜', id: '3779629' },
  { type: 'hot', name: '云音乐热歌榜', id: '3778678' },
  { type: 'origin', name: '云音乐原创榜', id: '2884035' }
];
async function renderRecommend() {
  pageTitle.textContent = '推荐';
  pageEl.innerHTML = `
    <div class="search-hero">
      <h2 style="font-size:24px;font-weight:800">为你推荐</h2>
      <p style="color:var(--text-dim);margin-top:6px;font-size:14px">各大榜单实时更新，发现你的下一首单曲循环。</p>
    </div>
    <div id="recCharts"></div>`;

  const wrap = $('#recCharts');
  wrap.innerHTML = CHARTS.map((c) => `
    <div class="section">
      <div class="section-head"><h2>${c.name}</h2>
        <button class="more" data-pl="${c.id}">查看全部 ›</button></div>
      <div id="chart-${c.type}">${loadingHTML()}</div>
    </div>`).join('');

  CHARTS.forEach((c) => {
    (async () => {
      try {
        if (!state.cache.charts[c.type]) state.cache.charts[c.type] = (await api.chart(c.type)).songs || [];
        const el = $(`#chart-${c.type}`);
        const songs = state.cache.charts[c.type].slice(0, 10);
        if (!songs.length) { el.innerHTML = emptyHTML('暂无数据'); return; }
        el.innerHTML = `<div class="song-list">${songs.map((s, i) => songRowHTML(s, i)).join('')}</div>`;
        bindSongRows(el, songs);
      } catch (e) { $(`#chart-${c.type}`).innerHTML = emptyHTML('加载失败'); }
    })();
  });

  wrap.querySelectorAll('[data-pl]').forEach((b) => b.addEventListener('click', () => {
    const c = CHARTS.find((x) => x.id === b.dataset.pl);
    go('playlist', { id: b.dataset.pl, title: c ? c.name : '歌单详情' });
  }));
}

/* ============================================================
   搜索页
   ============================================================ */
const HOT_TAGS = ['周杰伦', '陈奕迅', '林俊杰', '邓紫棋', '薛之谦', '民谣', '流行', '电子', '轻音乐', 'ACG'];
let searchTimer = null;
async function renderSearch(opts = {}) {
  pageTitle.textContent = '搜索';
  pageEl.innerHTML = `
    <div class="search-hero">
      <div class="search-big">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input id="searchInput" type="text" placeholder="搜索歌曲、歌手、专辑…" value="${esc(opts.keyword || '')}" autocomplete="off">
      </div>
      <div class="search-tags">
        ${HOT_TAGS.map((t) => `<button class="tag">${esc(t)}</button>`).join('')}
      </div>
    </div>
    <div id="searchResults"></div>`;

  const input = $('#searchInput');
  pageEl.querySelectorAll('.tag').forEach((t) => t.addEventListener('click', () => { input.value = t.textContent; doSearch(t.textContent); }));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(input.value); });

  if (opts.keyword) { doSearch(opts.keyword); }
  else { $('#searchResults').innerHTML = emptyHTML('输入关键词，开启探索 ✨'); }
}

async function doSearch(keyword) {
  keyword = (keyword || '').trim();
  if (!keyword) return;
  const box = $('#searchResults');
  box.innerHTML = loadingHTML(`搜索 “${esc(keyword)}”…`);
  try {
    const data = await api.search(keyword, 40, 1);
    const songs = data.songs || [];
    if (!songs.length) { box.innerHTML = emptyHTML('没有找到相关结果'); return; }
    box.innerHTML = `
      <div class="section-head" style="margin-bottom:10px"><h2>搜索结果</h2><span class="drawer-count">${data.total || songs.length} 首</span></div>
      <div class="song-list">${songs.map((s, i) => songRowHTML(s, i)).join('')}</div>`;
    bindSongRows(box, songs);
  } catch (e) {
    box.innerHTML = emptyHTML('搜索失败，请稍后重试');
  }
}

/* ============================================================
   我的喜欢
   ============================================================ */
function renderLikes() {
  pageTitle.textContent = '我的喜欢';
  const songs = state.likes;
  if (!songs.length) {
    pageEl.innerHTML = emptyHTML('还没有喜欢的歌曲，去发现喜欢的音乐吧 ♥');
    return;
  }
  pageEl.innerHTML = `
    <div class="section-head" style="margin:4px 2px 14px"><h2>我的喜欢</h2><span class="drawer-count">${songs.length} 首</span></div>
    <div class="song-list">${songs.map((s, i) => songRowHTML(s, i)).join('')}</div>`;
  bindSongRows(pageEl, songs);
}

/* ============================================================
   歌单详情
   ============================================================ */
async function renderPlaylistDetail(opts = {}) {
  if (!opts.id) { setPage('home'); return; }
  pageEl.innerHTML = loadingHTML('加载歌单…');
  try {
    const pl = await api.playlist(opts.id);
    pageTitle.textContent = pl.name || opts.title || '歌单详情';
    const songs = pl.songs || [];
    pageEl.innerHTML = `
      <div class="search-hero" style="display:flex;gap:18px;align-items:flex-end">
        <img src="${coverSrc(pl.cover)}" alt="" onerror="coverFallback(this)" style="width:130px;height:130px;border-radius:18px;object-fit:cover;box-shadow:var(--shadow)">
        <div>
          <h2 style="font-size:26px;font-weight:800">${esc(pl.name)}</h2>
          <p style="color:var(--text-dim);margin-top:8px;font-size:13px">${songs.length} 首</p>
          ${pl.description ? `<p style="color:var(--text-faint);margin-top:6px;font-size:12px;max-width:560px">${esc(pl.description)}</p>` : ''}
          <button class="play-btn" id="plPlayAll" style="margin-top:14px">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </button>
        </div>
      </div>
      <div class="section" style="margin-top:20px">
        <div class="song-list">${songs.map((s, i) => songRowHTML(s, i)).join('')}</div>
      </div>`;
    $('#plPlayAll').addEventListener('click', () => songs.length && playQueue(songs.slice(), 0));
    bindSongRows(pageEl, songs);
  } catch (e) {
    pageEl.innerHTML = emptyHTML('歌单加载失败');
  }
}

/* ============================================================
   播放器
   ============================================================ */
function playQueue(list, index) {
  state.queue = list;
  state.currentIndex = index;
  loadCurrent(true);
  renderQueue();
}

function loadCurrent(autoplay) {
  const song = state.queue[state.currentIndex];
  if (!song) return;
  // 先更新 UI（封面/标题/歌词等），音频 URL 异步解析
  updatePlayerUI(song);
  fetchLyrics(song.songId);
  highlightPlayingRow();
  renderQueue();
  // 释放上一次的 blob URL（避免内存泄漏）
  if (state._lastBlobUrl) { URL.revokeObjectURL(state._lastBlobUrl); state._lastBlobUrl = null; }
  // 异步解析音频 URL（Capacitor 模式下跟随重定向，避免 mixed content）
  resolveAudioUrl(song).then((url) => {
    if (!url) { toast('该歌曲暂时无法播放（可能版权限制）'); return; }
    if (url.startsWith('blob:')) state._lastBlobUrl = url;
    audio.src = url;
    audio.play().catch(() => toast('该歌曲暂时无法播放（可能版权限制）'));
    state.playing = true;
    togglePlayIcon();
  });
}

function updatePlayerUI(song) {
  $('#pbTitle').textContent = song.name;
  $('#pbArtist').textContent = artistsText(song);
  const cover = $('#pbCover');
  cover.src = coverSrc(song.album && song.album.cover);
  cover.onerror = () => coverFallback(cover);
  cover.style.opacity = '';
  cover.classList.add('spin');

  const mini = $('#nowPlayingMini');
  mini.hidden = false;
  $('#npCover').src = coverSrc(song.album && song.album.cover);
  $('#npCover').onerror = () => coverFallback($('#npCover'));
  $('#npTitle').textContent = song.name;
  $('#npArtist').textContent = artistsText(song);

  $('#pbLike').classList.toggle('liked', isLiked(song));
  $('#lyricsTitle').textContent = song.name;
  $('#lyricsArtist').textContent = artistsText(song);
  $('#lyricsBg').style.backgroundImage = `url("${(song.album && song.album.cover) || ''}")`;
  togglePlayIcon();
}

function togglePlay() {
  if (state.currentIndex < 0) {
    if (state.queue.length) { state.currentIndex = 0; loadCurrent(true); }
    else toast('请先选择一首歌曲');
    return;
  }
  if (audio.paused) { audio.play().catch(() => {}); state.playing = true; }
  else { audio.pause(); state.playing = false; }
  togglePlayIcon();
  highlightPlayingRow();
}
function togglePlayIcon() {
  $('.icon-play').style.display = state.playing ? 'none' : 'block';
  $('.icon-pause').style.display = state.playing ? 'block' : 'none';
  $('#pbCover').classList.toggle('spin', state.playing);
}

function next() {
  if (!state.queue.length) return;
  if (state.shuffle) {
    let i; do { i = Math.floor(Math.random() * state.queue.length); } while (i === state.currentIndex && state.queue.length > 1);
    state.currentIndex = i;
  } else {
    state.currentIndex = (state.currentIndex + 1) % state.queue.length;
  }
  loadCurrent(true);
}
function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  state.currentIndex = (state.currentIndex - 1 + state.queue.length) % state.queue.length;
  loadCurrent(true);
}

function onEnded() {
  if (state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (state.repeat === 'all' || state.currentIndex < state.queue.length - 1) next();
  else { state.playing = false; togglePlayIcon(); }
}

/* ---------- 进度条 ---------- */
let seeking = false;
function updateProgress() {
  if (seeking) return;
  const cur = audio.currentTime * 1000;
  const dur = audio.duration ? audio.duration * 1000 : (state.queue[state.currentIndex] ? state.queue[state.currentIndex].duration : 0) || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  $('#progressFill').style.width = pct + '%';
  $('#progressThumb').style.left = pct + '%';
  $('#timeNow').textContent = fmtTime(cur);
  $('#timeTotal').textContent = fmtTime(dur);
  syncLyrics(cur);
}
function seekTo(clientX) {
  const bar = $('#progress');
  const rect = bar.getBoundingClientRect();
  let pct = (clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  const dur = audio.duration || (state.queue[state.currentIndex] ? state.queue[state.currentIndex].duration / 1000 : 0);
  if (dur) audio.currentTime = pct * dur;
  $('#progressFill').style.width = pct * 100 + '%';
  $('#progressThumb').style.left = pct * 100 + '%';
}

/* ---------- 音量 ---------- */
function setVolume(pct) {
  pct = Math.max(0, Math.min(1, pct));
  audio.volume = pct;
  $('#volFill').style.width = pct * 100 + '%';
}

/* ---------- 播放列表抽屉 ---------- */
function renderQueue() {
  const list = $('#queueList');
  $('#queueCount').textContent = `${state.queue.length} 首`;
  if (!state.queue.length) { list.innerHTML = emptyHTML('播放列表为空'); return; }
  list.innerHTML = state.queue.map((s, i) => `
    <div class="q-item ${i === state.currentIndex ? 'active' : ''}" data-i="${i}">
      <img src="${coverSrc(s.album && s.album.cover)}" alt="" onerror="coverFallback(this)">
      <div>
        <div class="q-name">${esc(s.name)}</div>
        <div class="q-artist">${esc(artistsText(s))}</div>
      </div>
      <button class="icon-btn q-del" data-del="${i}" title="移除">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>`).join('');
  list.querySelectorAll('.q-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      state.currentIndex = parseInt(el.dataset.i, 10);
      loadCurrent(true);
    });
  });
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const i = parseInt(b.dataset.del, 10);
    state.queue.splice(i, 1);
    if (i === state.currentIndex) {
      if (state.queue.length) { state.currentIndex = Math.min(i, state.queue.length - 1); loadCurrent(true); }
      else { state.currentIndex = -1; audio.pause(); audio.src = ''; state.playing = false; togglePlayIcon(); }
    } else if (i < state.currentIndex) {
      state.currentIndex--;
    }
    renderQueue();
  }));
}
function toggleQueue(open) {
  const d = $('#queueDrawer');
  if (open === undefined) open = !d.classList.contains('open');
  d.classList.toggle('open', open);
}

/* ============================================================
   歌词
   ============================================================ */
function parseLrc(text) {
  if (!text) return [];
  const lines = text.split('\n');
  const out = [];
  const re = /\[(\d{2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for (const line of lines) {
    let m; const txt = line.replace(re, '').trim();
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const min = parseInt(m[1], 10), sec = parseInt(m[2], 10), ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      out.push({ t: min * 60000 + sec * 1000 + ms, text: txt });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
async function fetchLyrics(id) {
  state.lyrics = []; state.tlyric = [];
  const body = $('#lyricsBody');
  body.innerHTML = loadingHTML('歌词加载中…');
  try {
    const data = await api.lyric(id);
    state.lyrics = parseLrc(data.lyric);
    state.tlyric = parseLrc(data.tlyric);
    if (!state.lyrics.length) { body.innerHTML = '<div class="lyrics-empty">暂无歌词</div>'; return; }
    body.innerHTML = state.lyrics.map((l, i) => `<div class="lyric-line" data-i="${i}">${esc(l.text) || '·'}</div>`).join('');
  } catch (e) {
    body.innerHTML = '<div class="lyrics-empty">歌词加载失败</div>';
  }
}
function syncLyrics(ms) {
  if (!state.lyrics.length) return;
  let idx = -1;
  for (let i = 0; i < state.lyrics.length; i++) { if (state.lyrics[i].t <= ms) idx = i; else break; }
  if (idx < 0) return;
  const lines = $('#lyricsBody').querySelectorAll('.lyric-line');
  lines.forEach((l, i) => l.classList.toggle('active', i === idx));
  const active = lines[idx];
  if (active) {
    const body = $('#lyricsBody');
    const top = active.offsetTop - body.clientHeight / 2 + active.clientHeight / 2;
    body.scrollTo({ top, behavior: 'smooth' });
  }
}
function toggleLyrics(open) {
  const o = $('#lyricsOverlay');
  if (open === undefined) open = !o.classList.contains('open');
  o.classList.toggle('open', open);
}

/* ============================================================
   可拖拽液态玻璃调节器
   ============================================================ */
function initLiquidAdjuster() {
  const panel = $('#liquidAdjuster');
  const head = $('#laHead');
  const toggle = $('#laToggle');
  const blur = $('#laBlur');
  const opacity = $('#laOpacity');
  const spec = $('#laSpec');
  const refract = $('#laRefract');
  const hue = $('#laHue');
  const blurVal = $('#laBlurVal');
  const opacityVal = $('#laOpacityVal');
  const specVal = $('#laSpecVal');
  const refractVal = $('#laRefractVal');
  const hueVal = $('#laHueVal');
  const reset = $('#laReset');

  // 同步滑块显示到当前设置
  function syncUI() {
    const l = state.settings.liquid || DEFAULT_SETTINGS.liquid;
    blur.value = l.blur; blurVal.textContent = l.blur;
    opacity.value = l.opacity; opacityVal.textContent = l.opacity;
    spec.value = l.spec; specVal.textContent = l.spec;
    refract.value = l.refract ?? 14; refractVal.textContent = l.refract ?? 14;
    const h = l.hue;
    hue.value = (h === null || h === undefined) ? 220 : h;
    hueVal.textContent = (h === null || h === undefined) ? '默认' : h + '°';
  }
  syncUI();

  // 拖动整个面板
  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
  function onPointerDown(e) {
    if (e.target.closest('.la-toggle') || e.target.closest('input') || e.target.closest('.la-reset')) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    panel.style.right = 'auto';
    panel.style.left = startLeft + 'px';
    panel.style.top = startTop + 'px';
    panel.style.bottom = 'auto';
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging) return;
    let nx = startLeft + (e.clientX - startX);
    let ny = startTop + (e.clientY - startY);
    const w = panel.offsetWidth, h = panel.offsetHeight;
    nx = Math.max(8, Math.min(window.innerWidth - w - 8, nx));
    ny = Math.max(8, Math.min(window.innerHeight - h - 8, ny));
    panel.style.left = nx + 'px';
    panel.style.top = ny + 'px';
  }
  function onPointerUp() {
    dragging = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }
  head.addEventListener('pointerdown', onPointerDown);

  // 折叠 / 展开
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('collapsed');
  });
  // 移动端：点击小圆点展开
  panel.addEventListener('click', (e) => {
    if (window.matchMedia('(max-width: 720px)').matches && !panel.classList.contains('expanded') && !e.target.closest('input') && !e.target.closest('.la-reset')) {
      panel.classList.add('expanded');
    }
  });

  // 滑块实时更新
  function update() {
    const l = {
      blur: parseInt(blur.value, 10),
      opacity: parseInt(opacity.value, 10),
      spec: parseInt(spec.value, 10),
      refract: parseInt(refract.value, 10),
      hue: parseInt(hue.value, 10)
    };
    state.settings.liquid = l;
    blurVal.textContent = l.blur;
    opacityVal.textContent = l.opacity;
    specVal.textContent = l.spec;
    refractVal.textContent = l.refract;
    hueVal.textContent = l.hue + '°';
    applyLiquid();
    saveSettings();
  }
  [blur, opacity, spec, refract, hue].forEach((el) => el.addEventListener('input', update));

  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    state.settings.liquid = { ...DEFAULT_SETTINGS.liquid };
    saveSettings();
    applyLiquid();
    syncUI();
    toast('已恢复默认液态参数');
  });

  // 窗口大小变化时确保面板不越界
  window.addEventListener('resize', () => {
    if (panel.style.left) {
      const w = panel.offsetWidth, h = panel.offsetHeight;
      let nx = parseFloat(panel.style.left), ny = parseFloat(panel.style.top);
      nx = Math.max(8, Math.min(window.innerWidth - w - 8, nx));
      ny = Math.max(8, Math.min(window.innerHeight - h - 8, ny));
      panel.style.left = nx + 'px'; panel.style.top = ny + 'px';
    }
  });
}

/* ============================================================
   管理后台页（admin1 解锁后可见）
   ============================================================ */
let _adminStatsTimer = null;
async function renderAdmin() {
  if (!state.admin) { toast('权限不足'); setPage('home'); return; }
  pageEl.innerHTML = `
    <div class="search-hero">
      <h2 style="font-size:24px;font-weight:800">管理后台 <span class="admin-mark">ADMIN</span></h2>
      <p style="color:var(--text-dim);margin-top:6px;font-size:14px">服务器运行状态 · 接口统计 · 听歌识曲历史</p>
    </div>
    <div class="admin-grid" id="adminGrid">
      <div class="admin-card glass-soft loading">加载中…</div>
    </div>`;
  const loadStats = async () => {
    try {
      const res = await fetch('/api/admin/stats');
      const d = await res.json();
      const el = $('#adminGrid');
      if (!el) return;
      const upt = (() => {
        const s = d.uptimeSec || 0;
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
        return `${h}h ${m}m ${ss}s`;
      })();
      const hist = d.recognizeHistory || [];
      el.innerHTML = `
        <div class="admin-card glass-soft">
          <div class="ac-head"><span>系统</span><em class="ac-dot on"></em></div>
          <div class="ac-row"><label>Node 版本</label><b>${d.nodeVersion || '-'}</b></div>
          <div class="ac-row"><label>运行时长</label><b>${upt}</b></div>
          <div class="ac-row"><label>平台</label><b>${d.platform}</b></div>
          <div class="ac-row"><label>PID</label><b>${d.pid}</b></div>
        </div>
        <div class="admin-card glass-soft">
          <div class="ac-head"><span>内存</span></div>
          <div class="ac-row"><label>RSS</label><b>${d.memory?.rssMB ?? 0} MB</b></div>
          <div class="ac-row"><label>堆占用</label><b>${d.memory?.heapUsedMB ?? 0} / ${d.memory?.heapTotalMB ?? 0} MB</b></div>
          <div class="ac-bar"><div class="ac-bar-fill" style="width:${Math.min(99, (d.memory?.heapUsedMB || 0) * 100 / Math.max(1, d.memory?.heapTotalMB || 1))}%"></div></div>
        </div>
        <div class="admin-card glass-soft">
          <div class="ac-head"><span>请求</span></div>
          <div class="ac-row"><label>总请求</label><b>${d.requests?.total ?? 0}</b></div>
          <div class="ac-row"><label>API</label><b>${d.requests?.api ?? 0}</b></div>
          <div class="ac-row"><label>听歌识曲</label><b>${d.requests?.recognize ?? 0}</b></div>
          <div class="ac-row"><label>错误</label><b style="color:#ee5a6f">${d.errors ?? 0}</b></div>
        </div>
        <div class="admin-card glass-soft ac-wide">
          <div class="ac-head"><span>听歌识曲历史（最近 ${hist.length} 条）</span>
            <button class="icon-btn" id="adminShazamBtn" title="测试识别"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10" /><path d="M12 6v12a6 6 0 0 1-6-6" /><circle cx="12" cy="12" r="2" /></svg></button>
          </div>
          ${hist.length === 0 ? `<div class="ac-empty">暂无记录，点击右上角按钮测试一次识别</div>` :
            `<table class="ac-table">
              <thead><tr><th>时间</th><th>歌曲</th><th>歌手</th><th>匹配度</th><th></th></tr></thead>
              <tbody>${hist.map((h) => `<tr>
                <td>${new Date(h.at).toLocaleTimeString()}</td>
                <td>${esc(h.name)}</td>
                <td>${esc(h.artist)}</td>
                <td><b style="color:var(--accent)">${h.confidence}%</b></td>
                <td><button class="icon-btn" data-id="${h.songId}" title="搜索此歌"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg></button></td>
              </tr>`).join('')}</tbody>
            </table>`}
        </div>`;
      $('#adminShazamBtn')?.addEventListener('click', openShazam);
      el.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => go('search', { keyword: b.dataset.id })));
    } catch (e) {
      const el = $('#adminGrid'); if (el) el.innerHTML = `<div class="admin-card glass-soft" style="color:#ee5a6f">无法获取服务器数据：${esc(e.message)}</div>`;
    }
  };
  await loadStats();
  clearInterval(_adminStatsTimer);
  _adminStatsTimer = setInterval(loadStats, 3000);
  // 切页面时停
  setTimeout(() => {
    const cur = state.page;
    const t = setInterval(() => {
      if (state.page !== cur) { clearInterval(t); clearInterval(_adminStatsTimer); _adminStatsTimer = null; }
    }, 500);
  }, 0);
}

/* ============================================================
   Shazam 听歌识曲浮层
   ============================================================ */
function openShazam() {
  const ov = $('#shazamOverlay'); if (!ov) return;
  ov.hidden = false;
  // 重置到初始 idle 状态：显示 idle，隐藏 ring/result
  $('#shazamRing').hidden = true;
  $('#shazamResult').hidden = true;
  const idle = document.querySelector('.shazam-idle');
  if (idle) idle.hidden = false;
}
function closeShazam() {
  const ov = $('#shazamOverlay'); if (ov) ov.hidden = true;
  // 取消正在进行的识别
  if (_shazamTimer) { clearTimeout(_shazamTimer); _shazamTimer = null; }
  const ring = $('#shazamRing'); if (ring) ring.hidden = true;
}
let _shazamTimer = null;
let _shazamRecording = false;  // 是否正在录音（用于提前取消）
async function startShazam() {
  const idle = document.querySelector('.shazam-idle');
  const ring = $('#shazamRing');
  const resEl = $('#shazamResult');
  if (idle) idle.hidden = true;
  if (resEl) resEl.hidden = true;
  if (ring) ring.hidden = false;
  toast('正在录音，请播放一段音乐…');

  // 读取讯飞凭证（localStorage）
  const xfAppId = (localStorage.getItem('lm_xf_appid') || '').trim();
  const xfApiKey = (localStorage.getItem('lm_xf_apikey') || '').trim();
  // 读取 ACRCloud 凭证（优先于讯飞）
  const acrAccessKey = (localStorage.getItem('lm_acr_access_key') || ACR_DEFAULT_ACCESS_KEY).trim();
  const acrAccessSecret = (localStorage.getItem('lm_acr_access_secret') || ACR_DEFAULT_ACCESS_SECRET).trim();

  // 请求麦克风并真实录音 5 秒
  let audioBase64 = '';
  let micError = '';
  let gotMic = false;
  try {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      micError = '当前环境不支持麦克风访问（需 HTTPS 或 localhost）';
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      gotMic = true;
      _shazamRecording = true;
      audioBase64 = await recordToBase64(stream, 5000);
      _shazamRecording = false;
    }
  } catch (e) {
    _shazamRecording = false;
    micError = e.name === 'NotAllowedError' ? '麦克风授权被拒绝' :
               e.name === 'NotFoundError' ? '未检测到麦克风设备' :
               (e.message || '麦克风访问失败');
  }

  if (!gotMic) {
    if (ring) ring.hidden = true;
    if (resEl) resEl.hidden = false;
    resEl.innerHTML = `<div class="shazam-fail"><h3>无法录音</h3><p>${esc(micError || '请允许麦克风权限后重试')}</p><button class="play-btn shazam-btn" id="shazamRetry">重新识别</button></div>`;
    $('#shazamRetry')?.addEventListener('click', startShazam);
    return;
  }

  // 调用后端识别
  try {
    const r = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: audioBase64,
        appId: xfAppId, apiKey: xfApiKey,
        acrAccessKey, acrAccessSecret
      })
    }).then((x) => x.json());

    if (ring) ring.hidden = true;
    if (resEl) resEl.hidden = false;
    if (!r || !r.song) {
      resEl.innerHTML = `<div class="shazam-fail"><h3>无法识别</h3><p>${esc(r?.error || '请再试一次')}</p><button class="play-btn shazam-btn" id="shazamRetry">重新识别</button></div>`;
      $('#shazamRetry')?.addEventListener('click', startShazam);
      return;
    }
    const s = r.song;
    const modeText = r.mode === 'demo' ? ' · 演示模式（未配置 API）' :
                     r.mode === 'acr'  ? ' · ACRCloud 识别' :
                     r.mode === 'xf'   ? ' · 讯飞识别' : '';
    const noteMode = acrAccessKey ? '' : (xfAppId ? '' : ' · 未配置 API，使用演示模式');
    resEl.innerHTML = `
      <div class="shazam-song">
        <img src="${coverSrc(s.album?.cover)}" alt="" onerror="coverFallback(this)" />
        <div class="shazam-meta">
          <h3>${esc(s.name)}</h3>
          <p>${esc(artistsText(s))}</p>
          <div class="shazam-conf"><span>${r.confidence}%</span> 匹配${modeText}</div>
        </div>
      </div>
      <div class="shazam-actions">
        <button class="play-btn" id="shazamPlay">立即播放</button>
        <button class="icon-btn" id="shazamLike" title="加入喜欢"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg></button>
        <button class="icon-btn" id="shazamSearch" title="搜索更多版本"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg></button>
      </div>
      <div class="shazam-note">✅ 录音成功（${Math.round(audioBase64.length * 3 / 4 / 1024)}KB）${noteMode}</div>
    `;
    $('#shazamPlay')?.addEventListener('click', () => { closeShazam(); playQueue([s], 0); });
    $('#shazamLike')?.addEventListener('click', () => { toggleLike(s); });
    $('#shazamSearch')?.addEventListener('click', () => { closeShazam(); go('search', { keyword: s.name }); });
  } catch (e) {
    if (ring) ring.hidden = true;
    if (resEl) resEl.hidden = false;
    resEl.innerHTML = `<div class="shazam-fail"><h3>识别失败</h3><p>${esc(e.message)}</p><button class="play-btn shazam-btn" id="shazamRetry">重新识别</button></div>`;
    $('#shazamRetry')?.addEventListener('click', startShazam);
  }
}

/**
 * 录制指定时长音频，返回 16kHz 单声道 PCM 的 base64 编码（讯飞 raw 格式要求）
 * 直接用 ScriptProcessor 抓取 PCM，避免引入额外编码库
 */
function recordToBase64(stream, durationMs) {
  return new Promise((resolve, reject) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx({ sampleRate: 16000 });
      const source = audioCtx.createMediaStreamSource(stream);
      // buffer size 4096，单声道
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      const pcmChunks = [];
      processor.onaudioprocess = (e) => {
        if (!_shazamRecording) return;
        const input = e.inputBuffer.getChannelData(0);
        // float32 → int16
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        pcmChunks.push(int16);
      };
      source.connect(processor);
      processor.connect(audioCtx.destination);

      setTimeout(() => {
        try {
          _shazamRecording = false;
          processor.disconnect();
          source.disconnect();
          stream.getTracks().forEach((t) => t.stop());
          // 合并 PCM
          const total = pcmChunks.reduce((a, c) => a + c.length, 0);
          const pcm = new Int16Array(total);
          let off = 0;
          for (const c of pcmChunks) { pcm.set(c, off); off += c.length; }
          // 转为 Uint8Array 后 base64
          const bytes = new Uint8Array(pcm.buffer);
          let binary = '';
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
          }
          audioCtx.close();
          resolve(btoa(binary));
        } catch (e2) { reject(e2); }
      }, durationMs);
    } catch (e) { reject(e); }
  });
}
function bindShazamEvents() {
  $('#shazamNavBtn')?.addEventListener('click', openShazam);
  $('#shazamTopBtn')?.addEventListener('click', openShazam);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShazam(); });
  // 上传音频识别
  $('#shazamUploadBtn')?.addEventListener('click', () => $('#shazamFileInput')?.click());
  $('#shazamFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    recognizeFile(file);
  });
}

/* 上传音频文件 → base64 → 识别 */
async function recognizeFile(file) {
  const idle = document.querySelector('.shazam-idle');
  const ring = $('#shazamRing');
  const resEl = $('#shazamResult');
  if (idle) idle.hidden = true;
  if (resEl) resEl.hidden = true;
  if (ring) ring.hidden = false;
  toast('正在识别上传的音频…');
  try {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const b64 = btoa(binary);
    const acrAccessKey = (localStorage.getItem('lm_acr_access_key') || ACR_DEFAULT_ACCESS_KEY).trim();
    const acrAccessSecret = (localStorage.getItem('lm_acr_access_secret') || ACR_DEFAULT_ACCESS_SECRET).trim();
    const xfAppId = (localStorage.getItem('lm_xf_appid') || '').trim();
    const xfApiKey = (localStorage.getItem('lm_xf_apikey') || '').trim();
    const r = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: b64, appId: xfAppId, apiKey: xfApiKey, acrAccessKey, acrAccessSecret })
    }).then(x => x.json());
    if (ring) ring.hidden = true;
    if (resEl) resEl.hidden = false;
    if (!r || !r.song) {
      resEl.innerHTML = `<div class="shazam-fail"><h3>无法识别</h3><p>${esc(r?.error || '请再试一次')}</p><button class="play-btn shazam-btn" id="shazamRetry">重新识别</button></div>`;
      $('#shazamRetry')?.addEventListener('click', () => { if (idle) idle.hidden = false; if (resEl) resEl.hidden = true; });
      return;
    }
    const s = r.song;
    const modeText = r.mode === 'acr' ? ' · ACRCloud' : r.mode === 'xf' ? ' · 讯飞' : ' · 演示';
    resEl.innerHTML = `
      <div class="shazam-song">
        <img src="${coverSrc(s.album?.cover)}" alt="" onerror="coverFallback(this)" />
        <div class="shazam-meta">
          <h3>${esc(s.name)}</h3>
          <p>${esc(artistsText(s))}</p>
          <div class="shazam-conf"><span>${r.confidence}%</span> 匹配${modeText}</div>
        </div>
      </div>
      <div class="shazam-actions">
        <button class="play-btn" id="shazamPlay">立即播放</button>
        <button class="icon-btn" id="shazamLike" title="加入喜欢"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg></button>
      </div>`;
    $('#shazamPlay')?.addEventListener('click', () => { closeShazam(); playQueue([s], 0); });
    $('#shazamLike')?.addEventListener('click', () => toggleLike(s));
  } catch (err) {
    if (ring) ring.hidden = true;
    if (resEl) resEl.hidden = false;
    resEl.innerHTML = `<div class="shazam-fail"><h3>识别失败</h3><p>${esc(err.message)}</p><button class="play-btn shazam-btn" id="shazamRetry">重新识别</button></div>`;
    $('#shazamRetry')?.addEventListener('click', () => { if (idle) idle.hidden = false; if (resEl) resEl.hidden = true; });
  }
}
// 挂到 window 上，供 HTML onclick 内联调用（兜底，确保点击一定能响应）
window.openShazam = openShazam;
window.closeShazam = closeShazam;
window.startShazam = startShazam;

/* ============================================================
   设置页
   ============================================================ */
function renderSettings() {
  pageTitle.textContent = '设置';
  const s = state.settings;
  const vipMark = state.vip ? '<span class="vip-mark">VIP</span>' : '';
  const adminMark = state.admin ? '<span class="admin-mark">ADMIN</span>' : '';
  pageEl.innerHTML = `
    <div class="search-hero">
      <h2 style="font-size:24px;font-weight:800">设置 ${vipMark}${adminMark}</h2>
      <p style="color:var(--text-dim);margin-top:6px;font-size:14px">个性化你的液态玻璃体验，设置自动保存在本地。</p>
    </div>

    ${state.admin ? `
    <div class="settings-card glass-soft" style="max-width:640px;margin-bottom:16px">
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">进入管理后台</div><div class="s-desc">查看服务器运行状态、听歌识曲历史记录、调试接口</div></div>
        <button class="play-btn" id="adminGoto">后台</button>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">专家模式</div><div class="s-desc">所有歌曲行显示 songId / vendor 等调试信息</div></div>
        <div class="switch ${s.expertMode ? 'on' : ''}" id="expertSwitch" role="switch" tabindex="0"></div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">清空本地缓存</div><div class="s-desc">清除首页/推荐页接口缓存，刷新列表</div></div>
        <button class="play-btn" id="clearCacheBtn" style="background:linear-gradient(135deg,#ff6b6b,#ee5a6f)">清空</button>
      </div>
    </div>` : ''}

    <div class="settings-card glass-soft" style="max-width:640px">
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">界面过渡动画</div><div class="s-desc">按钮、悬停等交互动效</div></div>
        <div class="switch ${s.transitions ? 'on' : ''}" data-set="transitions" role="switch" tabindex="0"></div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">背景液态动画</div><div class="s-desc">背景色块流动、流光、颗粒</div></div>
        <div class="switch ${s.bgAnimation ? 'on' : ''}" data-set="bgAnimation" role="switch" tabindex="0"></div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">页面切换动画</div><div class="s-desc">切换页面时的入场效果</div></div>
        <div class="seg" data-set="pageAnimation">
          <button data-val="none" class="${s.pageAnimation === 'none' ? 'active' : ''}">无</button>
          <button data-val="fade" class="${s.pageAnimation === 'fade' ? 'active' : ''}">淡入</button>
          <button data-val="slide" class="${s.pageAnimation === 'slide' ? 'active' : ''}">上滑</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">界面布局密度</div><div class="s-desc">歌曲行间距与卡片间距</div></div>
        <div class="seg" data-set="density">
          <button data-val="compact" class="${s.density === 'compact' ? 'active' : ''}">紧凑</button>
          <button data-val="normal" class="${s.density === 'normal' ? 'active' : ''}">标准</button>
          <button data-val="comfortable" class="${s.density === 'comfortable' ? 'active' : ''}">宽松</button>
        </div>
      </div>
    </div>

    <div class="settings-card glass-soft" style="max-width:640px;margin-top:16px">
      <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:12px">
        <div class="setting-info">
          <div class="s-title">背景主题</div>
          <div class="s-desc">选择内置渐变主题或纯色背景</div>
        </div>
        <div class="bg-theme-grid" id="bgThemeGrid">
          <button class="bg-theme-chip ${(!s.background || s.background.mode !== 'color' && (!s.background || s.background.theme === 'default' || !s.background.theme)) ? 'active' : ''}" data-bg-mode="theme" data-bg-theme="default" style="background:linear-gradient(135deg,#5b8cff,#b06bff,#ff6b9d)">极光</button>
          <button class="bg-theme-chip ${s.background && s.background.mode === 'theme' && s.background.theme === 'ocean' ? 'active' : ''}" data-bg-mode="theme" data-bg-theme="ocean" style="background:linear-gradient(135deg,#0077be,#00a8cc,#2bd6c6)">深海</button>
          <button class="bg-theme-chip ${s.background && s.background.mode === 'theme' && s.background.theme === 'sunset' ? 'active' : ''}" data-bg-mode="theme" data-bg-theme="sunset" style="background:linear-gradient(135deg,#ff6b35,#f7931e,#ff4757)">日落</button>
          <button class="bg-theme-chip ${s.background && s.background.mode === 'theme' && s.background.theme === 'forest' ? 'active' : ''}" data-bg-mode="theme" data-bg-theme="forest" style="background:linear-gradient(135deg,#2d6a4f,#40916c,#74c69d)">森林</button>
          <button class="bg-theme-chip ${s.background && s.background.mode === 'theme' && s.background.theme === 'cherry' ? 'active' : ''}" data-bg-mode="theme" data-bg-theme="cherry" style="background:linear-gradient(135deg,#ff4757,#ff6b81,#c44569)">樱花</button>
          <button class="bg-theme-chip ${s.background && s.background.mode === 'theme' && s.background.theme === 'dark' ? 'active' : ''}" data-bg-mode="theme" data-bg-theme="dark" style="background:linear-gradient(135deg,#2c2c54,#474787,#3d3d5c)">暗夜</button>
          <button class="bg-theme-chip ${s.background && s.background.mode === 'color' ? 'active' : ''}" data-bg-mode="color" id="bgColorChip" style="background:${(s.background && s.background.color) || '#0a0a1a'}">纯色</button>
        </div>
        <div class="bg-color-row" id="bgColorRow" style="display:${s.background && s.background.mode === 'color' ? 'flex' : 'none'};align-items:center;gap:8px">
          <input type="color" id="bgColorInput" value="${(s.background && s.background.color) || '#0a0a1a'}" style="width:48px;height:32px;border:none;border-radius:8px;cursor:pointer;background:transparent" />
          <span style="font-size:13px;color:var(--text-dim)">自定义纯色背景</span>
        </div>
      </div>
    </div>

    <div class="settings-card glass-soft" style="max-width:640px;margin-top:16px">
      <div class="setting-row">
        <div class="setting-info">
          <div class="s-title">液态玻璃参数 ${vipMark}</div>
          <div class="s-desc">拖动右上角悬浮面板可实时调节模糊强度、透明度与高光</div>
        </div>
        <div class="switch ${state.settings.liquid ? 'on' : ''}" id="liquidShow" role="switch" tabindex="0"></div>
      </div>
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">解锁码</div><div class="s-desc">输入后回车确认，可切换主题与功能</div></div>
        <div class="vip-input" style="margin:0;max-width:200px">
          <input id="vipInput" type="text" maxlength="8" placeholder="输入解锁码" autocomplete="off" />
        </div>
      </div>
      ${state.vip ? `
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">VIP 黑金主题 ${vipMark}</div><div class="s-desc">已解锁，可开关切换</div></div>
        <div class="switch on" id="vipToggle" role="switch" tabindex="0"></div>
      </div>` : ''}
      ${state.admin ? `
      <div class="setting-row">
        <div class="setting-info"><div class="s-title">管理员模式 ${adminMark}</div><div class="s-desc">已解锁，可开关切换</div></div>
        <div class="switch on" id="adminToggle" role="switch" tabindex="0"></div>
      </div>` : ''}
    </div>

    <div class="settings-card glass-soft" style="max-width:640px;margin-top:16px">
      <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="setting-info">
          <div class="s-title">听歌识曲 · 讯飞 API</div>
          <div class="s-desc">配置讯飞哼唱识别凭证后启用真实识别；留空则使用演示模式（热歌榜加权抽取）。凭证仅保存在本设备 localStorage。</div>
        </div>
        <div class="vip-input" style="margin:0;max-width:300px">
          <input id="xfAppIdInput" type="text" maxlength="32" placeholder="讯飞 AppID（如 5d3a****）" autocomplete="off" />
        </div>
        <div class="vip-input" style="margin:0;max-width:300px">
          <input id="xfApiKeyInput" type="text" maxlength="64" placeholder="讯飞 ApiKey（如 7e2c****）" autocomplete="off" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="play-btn" id="xfSaveBtn" style="padding:6px 14px;font-size:13px">保存凭证</button>
          <button class="play-btn" id="xfClearBtn" style="padding:6px 14px;font-size:13px;background:linear-gradient(135deg,#636e72,#2d3436)">清除凭证</button>
        </div>
        <p id="xfStatus" style="font-size:12px;color:var(--text-faint);margin:4px 0 0"></p>
      </div>
    </div>

    <div class="settings-card glass-soft" style="max-width:640px;margin-top:16px">
      <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="setting-info">
          <div class="s-title">听歌识曲 · ACRCloud API（优先）</div>
          <div class="s-desc">配置 ACRCloud 凭证后优先使用 ACRCloud 识别（识别率更高、支持原曲识别）；凭证仅保存在本设备 localStorage。未填则回退到讯飞 / 演示模式。</div>
        </div>
        <div class="vip-input" style="margin:0;max-width:300px">
          <input id="acrAccessKeyInput" type="text" maxlength="64" placeholder="ACRCloud Access Key" autocomplete="off" />
        </div>
        <div class="vip-input" style="margin:0;max-width:300px">
          <input id="acrAccessSecretInput" type="password" maxlength="128" placeholder="ACRCloud Access Secret" autocomplete="off" />
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="play-btn" id="acrSaveBtn" style="padding:6px 14px;font-size:13px">保存凭证</button>
          <button class="play-btn" id="acrClearBtn" style="padding:6px 14px;font-size:13px;background:linear-gradient(135deg,#636e72,#2d3436)">清除凭证</button>
        </div>
        <p id="acrStatus" style="font-size:12px;color:var(--text-faint);margin:4px 0 0"></p>
      </div>
    </div>

    <div class="search-hero" style="margin-top:22px;max-width:640px">
      <p style="color:var(--text-faint);font-size:12px;line-height:1.7">
        快捷键：空格 播放/暂停 · Ctrl+→ 下一首 · Ctrl+← 上一首<br>
        运行环境：${isCapacitorNative ? 'Capacitor 原生（直连冈易云）' : 'Web（后端代理 /api）'}
      </p>
    </div>`;

  // 开关
  pageEl.querySelectorAll('.switch[data-set]').forEach((sw) => {
    const toggle = () => {
      const key = sw.dataset.set;
      state.settings[key] = !state.settings[key];
      saveSettings(); applySettings();
      sw.classList.toggle('on', state.settings[key]);
      toast(state.settings[key] ? '已开启' : '已关闭');
    };
    sw.addEventListener('click', toggle);
    sw.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  // 分段选择
  pageEl.querySelectorAll('.seg').forEach((seg) => {
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.settings[seg.dataset.set] = b.dataset.val;
      saveSettings(); applySettings();
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      if (seg.dataset.set === 'density') toast('密度已切换为「' + b.textContent + '」');
      else toast('已切换为「' + b.textContent + '」');
    }));
  });

  // 背景主题选择
  const bgThemeGrid = $('#bgThemeGrid');
  if (bgThemeGrid) {
    const bgColorRow = $('#bgColorRow');
    const bgColorInput = $('#bgColorInput');
    const bgColorChip = $('#bgColorChip');
    bgThemeGrid.querySelectorAll('.bg-theme-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const mode = chip.dataset.bgMode;
        bgThemeGrid.querySelectorAll('.bg-theme-chip').forEach((c) => c.classList.toggle('active', c === chip));
        if (mode === 'color') {
          state.settings.background = { mode: 'color', color: (bgColorInput && bgColorInput.value) || '#0a0a1a', theme: 'default' };
          if (bgColorRow) bgColorRow.style.display = 'flex';
        } else {
          state.settings.background = { mode: 'theme', theme: chip.dataset.bgTheme || 'default', color: '#0a0a1a' };
          if (bgColorRow) bgColorRow.style.display = 'none';
        }
        saveSettings(); applyBackground();
        toast('背景已切换为「' + chip.textContent + '」');
      });
    });
    if (bgColorInput) {
      bgColorInput.addEventListener('input', () => {
        state.settings.background = { mode: 'color', color: bgColorInput.value, theme: 'default' };
        if (bgColorChip) bgColorChip.style.background = bgColorInput.value;
        saveSettings(); applyBackground();
      });
    }
  }

  // 液态面板显隐
  const liquidShow = $('#liquidShow');
  if (liquidShow) {
    const adj = $('#liquidAdjuster');
    liquidShow.classList.toggle('on', adj.style.display !== 'none');
    liquidShow.addEventListener('click', () => {
      const isOn = adj.style.display === 'none';
      adj.style.display = isOn ? '' : 'none';
      liquidShow.classList.toggle('on', isOn);
      toast(isOn ? '液态调节面板已显示' : '液态调节面板已隐藏');
    });
  }

  // 讯飞 API 凭证
  const xfAppIdInput = $('#xfAppIdInput');
  const xfApiKeyInput = $('#xfApiKeyInput');
  const xfStatus = $('#xfStatus');
  if (xfAppIdInput && xfApiKeyInput) {
    // 回显已保存的凭证（脱敏显示）
    const savedAppId = localStorage.getItem('lm_xf_appid') || '';
    const savedApiKey = localStorage.getItem('lm_xf_apikey') || '';
    xfAppIdInput.value = savedAppId;
    xfApiKeyInput.value = savedApiKey;
    const updateXfStatus = () => {
      if (savedAppId && savedApiKey) {
        xfStatus.textContent = '✅ 已配置凭证（识别时使用讯飞 API）';
        xfStatus.style.color = '#52c41a';
      } else {
        xfStatus.textContent = '⚠️ 未配置凭证（识别时使用演示模式）';
        xfStatus.style.color = 'var(--text-faint)';
      }
    };
    updateXfStatus();
    $('#xfSaveBtn')?.addEventListener('click', () => {
      const appId = (xfAppIdInput.value || '').trim();
      const apiKey = (xfApiKeyInput.value || '').trim();
      if (appId) localStorage.setItem('lm_xf_appid', appId);
      else localStorage.removeItem('lm_xf_appid');
      if (apiKey) localStorage.setItem('lm_xf_apikey', apiKey);
      else localStorage.removeItem('lm_xf_apikey');
      toast(appId && apiKey ? '讯飞凭证已保存' : '凭证已清除（演示模式）');
      // 重新刷新状态
      const newAppId = localStorage.getItem('lm_xf_appid') || '';
      const newApiKey = localStorage.getItem('lm_xf_apikey') || '';
      if (newAppId && newApiKey) {
        xfStatus.textContent = '✅ 已配置凭证（识别时使用讯飞 API）';
        xfStatus.style.color = '#52c41a';
      } else {
        xfStatus.textContent = '⚠️ 未配置凭证（识别时使用演示模式）';
        xfStatus.style.color = 'var(--text-faint)';
      }
    });
    $('#xfClearBtn')?.addEventListener('click', () => {
      localStorage.removeItem('lm_xf_appid');
      localStorage.removeItem('lm_xf_apikey');
      xfAppIdInput.value = '';
      xfApiKeyInput.value = '';
      xfStatus.textContent = '⚠️ 未配置凭证（识别时使用演示模式）';
      xfStatus.style.color = 'var(--text-faint)';
      toast('讯飞凭证已清除');
    });
  }

  // ACRCloud API 凭证（优先于讯飞）
  const acrAccessKeyInput = $('#acrAccessKeyInput');
  const acrAccessSecretInput = $('#acrAccessSecretInput');
  const acrStatus = $('#acrStatus');
  if (acrAccessKeyInput && acrAccessSecretInput) {
    acrAccessKeyInput.value = localStorage.getItem('lm_acr_access_key') || ACR_DEFAULT_ACCESS_KEY;
    acrAccessSecretInput.value = localStorage.getItem('lm_acr_access_secret') || ACR_DEFAULT_ACCESS_SECRET;
    const updateAcrStatus = (k, s) => {
      if (k && s) {
        acrStatus.textContent = '✅ 已配置 ACRCloud 凭证（识别时优先使用 ACRCloud）';
        acrStatus.style.color = '#52c41a';
      } else {
        acrStatus.textContent = '⚠️ 未配置 ACRCloud（将回退到讯飞 / 演示模式）';
        acrStatus.style.color = 'var(--text-faint)';
      }
    };
    updateAcrStatus(acrAccessKeyInput.value, acrAccessSecretInput.value);
    $('#acrSaveBtn')?.addEventListener('click', () => {
      const k = (acrAccessKeyInput.value || '').trim();
      const s = (acrAccessSecretInput.value || '').trim();
      if (k) localStorage.setItem('lm_acr_access_key', k);
      else localStorage.removeItem('lm_acr_access_key');
      if (s) localStorage.setItem('lm_acr_access_secret', s);
      else localStorage.removeItem('lm_acr_access_secret');
      updateAcrStatus(k, s);
      toast(k && s ? 'ACRCloud 凭证已保存' : 'ACRCloud 凭证已清除');
    });
    $('#acrClearBtn')?.addEventListener('click', () => {
      localStorage.removeItem('lm_acr_access_key');
      localStorage.removeItem('lm_acr_access_secret');
      acrAccessKeyInput.value = '';
      acrAccessSecretInput.value = '';
      updateAcrStatus('', '');
      toast('ACRCloud 凭证已清除');
    });
  }

  // 解锁码：哈希比对，无明文
  const vipInput = $('#vipInput');
  if (vipInput) {
    vipInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = (vipInput.value || '').trim();
      if (!v) return;
      const h = _h(v);
      if (h === '7c794db0') {
        setVip(!state.vip);
        toast(state.vip ? 'VIP 主题已开启' : '已退出 VIP 主题');
        vipInput.value = '';
        renderSettings();
      } else if (h === 'f1728e7f') {
        setAdmin(!state.admin);
        toast(state.admin ? '管理员已开启' : '已退出管理员');
        vipInput.value = '';
        renderSettings();
      } else if (h === '7c785653' && state.admin) {
        _antiReverse = !_antiReverse;
        _applyAntiReverse();
        toast(_antiReverse ? '保护模式已开启' : '保护模式已关闭');
        vipInput.value = '';
      } else if (v) {
        toast('解锁码无效');
        vipInput.value = '';
      }
    });
  }
  // VIP / 管理员开关
  $('#vipToggle')?.addEventListener('click', () => {
    setVip(!state.vip); toast(state.vip ? 'VIP 已开启' : 'VIP 已关闭'); renderSettings();
  });
  $('#adminToggle')?.addEventListener('click', () => {
    setAdmin(!state.admin); toast(state.admin ? '管理员已开启' : '管理员已关闭'); renderSettings();
  });

  // Admin 功能按钮
  const ag = $('#adminGoto');
  if (ag) ag.addEventListener('click', () => go('admin'));
  const es = $('#expertSwitch');
  if (es) {
    es.addEventListener('click', () => {
      state.settings.expertMode = !state.settings.expertMode;
      saveSettings();
      es.classList.toggle('on', state.settings.expertMode);
      toast(state.settings.expertMode ? '专家模式已开启' : '专家模式已关闭');
    });
  }
  const cc = $('#clearCacheBtn');
  if (cc) cc.addEventListener('click', () => {
    state.cache = { playlists: null, charts: {} };
    toast('本地缓存已清空');
  });
}

/* ============================================================
   事件绑定
   ============================================================ */
function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => {
    state.history = [];
    setPage(b.dataset.page);
  }));
  $('#backBtn').addEventListener('click', back);

  $('#globalSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) go('search', { keyword: e.target.value.trim() });
  });

  $('#playBtn').addEventListener('click', togglePlay);
  $('#prevBtn').addEventListener('click', prev);
  $('#nextBtn').addEventListener('click', next);
  $('#pbLike').addEventListener('click', () => {
    const s = state.queue[state.currentIndex];
    if (s) toggleLike(s); else toast('暂无播放中的歌曲');
  });
  $('#shuffleBtn').addEventListener('click', (e) => {
    state.shuffle = !state.shuffle;
    e.currentTarget.classList.toggle('active', state.shuffle);
    toast(state.shuffle ? '随机播放已开启' : '随机播放已关闭');
  });
  $('#repeatBtn').addEventListener('click', (e) => {
    const order = ['off', 'all', 'one'];
    state.repeat = order[(order.indexOf(state.repeat) + 1) % order.length];
    e.currentTarget.classList.toggle('active', state.repeat !== 'off');
    toast(state.repeat === 'off' ? '循环已关闭' : state.repeat === 'all' ? '列表循环' : '单曲循环');
  });

  // 进度条
  const prog = $('#progress');
  const onSeekMove = (clientX) => seekTo(clientX);
  prog.addEventListener('mousedown', (e) => { seeking = true; onSeekMove(e.clientX); const move = (ev) => onSeekMove(ev.clientX); const up = () => { seeking = false; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); });
  prog.addEventListener('touchstart', (e) => { seeking = true; onSeekMove(e.touches[0].clientX); }, { passive: true });
  prog.addEventListener('touchmove', (e) => { if (seeking) onSeekMove(e.touches[0].clientX); }, { passive: true });
  prog.addEventListener('touchend', () => { seeking = false; });
  prog.addEventListener('click', (e) => onSeekMove(e.clientX));

  // 音量
  const vol = $('#volBar');
  const onVolMove = (clientX) => { const r = vol.getBoundingClientRect(); setVolume((clientX - r.left) / r.width); };
  vol.addEventListener('mousedown', (e) => { onVolMove(e.clientX); const move = (ev) => onVolMove(ev.clientX); const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); });
  vol.addEventListener('touchstart', (e) => onVolMove(e.touches[0].clientX), { passive: true });
  vol.addEventListener('touchmove', (e) => onVolMove(e.touches[0].clientX), { passive: true });
  vol.addEventListener('click', (e) => onVolMove(e.clientX));

  // 抽屉 / 歌词
  $('#queueBtn').addEventListener('click', () => toggleQueue());
  $('#queueClose').addEventListener('click', () => toggleQueue(false));
  $('#queueMask').addEventListener('click', () => toggleQueue(false));
  $('#lyricBtn').addEventListener('click', () => toggleLyrics());
  $('#lyricsClose').addEventListener('click', () => toggleLyrics(false));

  // 音频事件
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('play', () => { state.playing = true; togglePlayIcon(); });
  audio.addEventListener('pause', () => { state.playing = false; togglePlayIcon(); });
  audio.addEventListener('error', () => { toast('播放失败，换一首试试'); });

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight' && e.ctrlKey) { e.preventDefault(); next(); }
    else if (e.code === 'ArrowLeft' && e.ctrlKey) { e.preventDefault(); prev(); }
  });

  // 媒体键
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', next);
  }

  // PWA 安装
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    const btn = $('#installBtn');
    if (btn) btn.hidden = false;
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    const { outcome } = await state.deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('已添加到主屏幕');
    state.deferredPrompt = null;
    $('#installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('安装成功'); });
}

/* ---------- PWA Service Worker 注册（仅 Web） ---------- */
function registerSW() {
  if (isCapacitorNative) return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 静默失败 */ });
  });
}

/* ============================================================
   启动
   ============================================================ */
/* 滚动收缩：向下滚隐藏底部 tab bar / 迷你播放器，向上滚展开 */
function bindScrollCollapse() {
  let lastY = 0;
  let ticking = false;
  let collapsed = false;
  let cooldown = 0;
  pageEl.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = pageEl.scrollTop;
      const now = Date.now();
      if (now < cooldown) { lastY = y; ticking = false; return; }
      if (y < 30) {
        if (collapsed) { document.body.classList.remove('nav-collapsed'); collapsed = false; cooldown = now + 400; }
      } else if (y > lastY + 30 && y > 80) {
        if (!collapsed) { document.body.classList.add('nav-collapsed'); collapsed = true; cooldown = now + 400; }
      } else if (y < lastY - 30) {
        if (collapsed) { document.body.classList.remove('nav-collapsed'); collapsed = false; cooldown = now + 400; }
      }
      lastY = y;
      ticking = false;
    });
  }, { passive: true });
  // 窗口尺寸变化时重新定位导航指示器（桌面↔移动切换会改变 nav 布局）
  let _navResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_navResizeTimer);
    _navResizeTimer = setTimeout(() => updateNavIndicator(), 150);
  });
}
function init() {
  updateLikesBadge();
  applySettings();
  $('#pbCover').src = COVER_FALLBACK;
  setVolume(0.8);
  setAdmin(state.admin); // admin 解锁状态初始化
  bindEvents();
  bindShazamEvents();
  initLiquidAdjuster();
  bindScrollCollapse();
  bindBtnBounce();
  registerSW();
  setPage('home');
}

/* 全局按钮点击回弹动画：缩小→上抬→放大→回弹
   覆盖 .icon-btn/.nav-item/.play-btn/.random-play-btn/.tag/.pl-card/.song-row */
const BOUNCE_SELECTOR = '.icon-btn,.nav-item,.play-btn,.random-play-btn,.tag,.pl-card,.song-row';
function bindBtnBounce() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest(BOUNCE_SELECTOR);
    if (!btn) return;
    btn.classList.remove('btn-bounce');
    // 强制 reflow，重启动画避免连续点击叠加
    void btn.offsetWidth;
    btn.classList.add('btn-bounce');
    setTimeout(() => btn.classList.remove('btn-bounce'), 500);
  }, true);
}

init();
