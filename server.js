/**
 * Liquid Music - 后端服务
 *
 * 零依赖：仅使用 Node.js 内置模块。
 * 数据来源：冈易云音乐公开接口。
 * 数据结构对齐 @suen/music-api（songInfo / search / getSongDetail / getSongUrl）。
 *   - search({ keyword, limit, page }) -> { total, songs: songInfo[] }
 *   - getSongDetail(ids[]) -> songInfo[]
 *   - getSongUrl(id) -> string
 * 参考: https://sunzongzheng.github.io/musicApi/
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/** 全局统计（内存中，重启清零） */
const serverStats = {
  startedAt: Date.now(),
  requests: { total: 0, api: 0, recognize: 0 },
  errors: 0,
  recognizeHistory: []
};
function countReq(isApi, isRec) {
  serverStats.requests.total++;
  if (isApi) serverStats.requests.api++;
  if (isRec) serverStats.requests.recognize++;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const COMMON_HEADERS = {
  'User-Agent': UA,
  'Referer': 'https://music.163.com',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9'
};

/** 发起 HTTP(S) 请求并返回 { status, headers, body }
 *  使用全局 fetch（Node 18+ 原生，兼容 Vercel Serverless），自动跟随重定向 */
async function request(method, fullUrl, { headers = {}, body = null } = {}) {
  let u;
  try { u = new URL(fullUrl); } catch (e) { throw new Error('invalid url: ' + fullUrl); }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const init = {
      method,
      headers: { ...COMMON_HEADERS, ...headers },
      signal: controller.signal,
      redirect: 'follow'
    };
    if (body) init.body = body;
    const resp = await fetch(fullUrl, init);
    // resp.text() 按 UTF-8 解码，与旧实现一致
    const text = await resp.text();
    const respHeaders = {};
    resp.headers.forEach((value, key) => { respHeaders[key] = value; });
    return { status: resp.status, headers: respHeaders, body: text };
  } finally {
    clearTimeout(timer);
  }
}

function safeJSON(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

/** 规整为 @suen/music-api 的 songInfo 结构 */
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

// ---------- 业务方法（对齐 @suen/music-api） ----------

/** 搜索：search({ keyword, limit, page })
 *  依次尝试 /api/search/pc 与 /api/search/get 两个公开端点以提升可用性 */
async function search(keyword, limit = 30, page = 1) {
  const offset = (Math.max(1, page) - 1) * limit;
  const form = `s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${limit}`;
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const endpoints = [
    'https://music.163.com/api/search/pc',
    'https://music.163.com/api/search/get'
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const res = await request('POST', url, { headers, body: form });
      const json = safeJSON(res.body) || {};
      const list = (json.result && json.result.songs) || [];
      if (list.length || (json.code === 200)) {
        return { total: (json.result && json.result.songCount) || list.length, songs: list.map(normalizeSong) };
      }
      lastErr = new Error('empty');
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return { total: 0, songs: [] };
}

/** 获取歌曲详情：getSongDetail(ids) */
async function getSongDetail(ids) {
  if (!ids || !ids.length) return [];
  const res = await request('GET', `https://music.163.com/api/song/detail/?ids=[${ids.join(',')}]`);
  const json = safeJSON(res.body) || {};
  return (json.songs || []).map(normalizeSong);
}

/** 获取歌曲Url：getSongUrl(id) -> 返回可直接播放的外链 */
function getSongUrl(id) {
  return `https://music.163.com/song/media/outer/url?id=${id}.mp3`;
}

/** 歌单详情（按 id 获取曲目列表） */
async function getPlaylist(id) {
  const res = await request('GET', `https://music.163.com/api/playlist/detail?id=${id}`);
  const json = safeJSON(res.body) || {};
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

/** 热门歌单列表（首页“精选歌单”） */
async function getTopPlaylists(limit = 12) {
  const res = await request('GET', `https://music.163.com/api/playlist/list?cat=%E5%85%A8%E9%A8%A8&order=hot&limit=${limit}&offset=0`);
  const json = safeJSON(res.body) || {};
  const list = json.playlists || [];
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    cover: p.coverImgUrl || p.picUrl || '',
    playCount: p.playCount || 0,
    trackCount: p.trackCount || 0
  }));
}

/** 歌词 */
async function getLyric(id) {
  const res = await request('GET', `https://music.163.com/api/song/lyric?os=pc&id=${id}&lv=-1&kv=-1&tv=-1`);
  const json = safeJSON(res.body) || {};
  return {
    lyric: (json.lrc && json.lrc.lyric) || '',
    tlyric: (json.tlyric && json.tlyric.lyric) || ''
  };
}

// ---------- 酷狗音乐 ----------
const KUGOU_HEADERS = { 'User-Agent': UA, 'Referer': 'https://www.kugou.com/', 'Accept': '*/*' };

async function searchKugou(keyword, limit = 20, page = 1) {
  const url = `http://msearch.kugou.com/api/v3/search/song?keyword=${encodeURIComponent(keyword)}&page=${page}&pagesize=${limit}&showtype=10`;
  const res = await request('GET', url, { headers: KUGOU_HEADERS });
  const json = safeJSON(res.body) || {};
  const list = (json.data && json.data.info) || [];
  return {
    total: (json.data && json.data.total) || list.length,
    songs: list.map(s => ({
      songId: s.hash,
      name: (s.songname || '').replace(/<[^>]+>/g, ''),
      album: { id: s.album_id, name: (s.album_name || '').replace(/<[^>]+>/g, ''), cover: '' },
      artists: (s.singername || '').split('、').map(n => ({ id: 0, name: n.trim() })),
      duration: (s.duration || 0) * 1000,
      vendor: 'kugou'
    }))
  };
}

async function getKugouUrl(hash, albumId) {
  const url = `http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`;
  const res = await request('GET', url, { headers: KUGOU_HEADERS });
  const json = safeJSON(res.body) || {};
  return json.url || '';
}

// ---------- QQ 音乐 ----------
const QQ_HEADERS = { 'User-Agent': UA, 'Referer': 'https://y.qq.com/', 'Accept': '*/*' };

async function searchQQ(keyword, limit = 20, page = 1) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&format=json&n=${limit}&p=${page}&cr=1&g_tk=5381`;
  const res = await request('GET', url, { headers: QQ_HEADERS });
  const json = safeJSON(res.body) || {};
  const list = (json.data && json.data.song && json.data.song.list) || [];
  return {
    total: (json.data && json.data.song && json.data.song.totalnum) || list.length,
    songs: list.map(s => ({
      songId: s.songmid,
      name: s.songname,
      album: { id: s.albummid, name: s.albumname, cover: s.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '' },
      artists: (s.singer || []).map(a => ({ id: a.mid, name: a.name })),
      duration: (s.interval || 0) * 1000,
      vendor: 'qq'
    }))
  };
}

async function getQQUrl(songmid) {
  // Try direct stream URL pattern
  const guid = '10000';
  const url = `https://ws.stream.qqmusic.qq.com/C400${songmid}.m4a?fromtag=0&guid=${guid}`;
  // Verify with HEAD request
  try {
    const check = await request('HEAD', url, { headers: QQ_HEADERS, redirects: 1 });
    if (check.status === 200) return url;
  } catch (e) {}
  // Fallback: try musicu.fcg API
  try {
    const apiUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
    const postData = JSON.stringify({
      req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid, songmid: [songmid], songtype: [0], uin: '0', loginflag: 1, platform: '20' } }
    });
    const res = await request('POST', apiUrl, { headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' }, body: postData });
    const json = safeJSON(res.body) || {};
    const info = json.req_0 && json.req_0.data && json.req_0.data.midurlinfo && json.req_0.data.midurlinfo[0];
    if (info && info.purl) return `https://dl.stream.qqmusic.qq.com/${info.purl}`;
  } catch (e) {}
  return '';
}

/* 酷狗排行榜 */
async function chartKugou(limit = 10) {
  const url = `http://m.kugou.com/rank/info?rankid=23784&page=1&pagesize=${limit}&format=json`;
  const res = await request('GET', url, { headers: KUGOU_HEADERS });
  const json = safeJSON(res.body) || {};
  const list = (json.songs && json.songs.info) || (json.data && json.data.info) || [];
  return list.slice(0, limit).map(s => ({
    songId: s.hash || s.FileHash,
    name: (s.songname || s.SongName || '').replace(/<[^>]+>/g, ''),
    album: { id: s.album_id || '', name: '', cover: '' },
    artists: (s.singername || s.SingerName || '未知').split('、').map(n => ({ id: 0, name: n.trim() })),
    duration: 0,
    vendor: 'kugou'
  }));
}

/* QQ 排行榜 */
async function chartQQ(limit = 10) {
  const postData = JSON.stringify({ req_0: { module: 'musicToplist.TopListInfo', method: 'GetDetail', param: { topId: 26, offset: 0, size: limit } } });
  const res = await request('POST', 'https://u.y.qq.com/cgi-bin/musicu.fcg', { headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' }, body: postData });
  const json = safeJSON(res.body) || {};
  const list = (json.req_0 && json.req_0.data && json.req_0.data.data && json.req_0.data.data.songInfoList) || [];
  return list.slice(0, limit).map(s => {
    const info = s.songInfo || s;
    return {
      songId: info.songmid || info.mid,
      name: info.songname || info.title,
      album: { id: info.albummid || '', name: info.albumname || info.album?.name || '', cover: info.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${info.albummid}.jpg` : '' },
      artists: (info.singer || []).map(a => ({ id: a.mid, name: a.name })),
      duration: (info.interval || 0) * 1000,
      vendor: 'qq'
    };
  });
}

/**
 * 哼唱识曲（讯飞 API）
 * 接收 base64 编码的 WAV/PCM 音频，调用讯飞 webqbh 接口识别
 * 无凭证时降级为演示模式
 */
async function recognizeHumming(audioBase64, appId, apiKey) {
  // 无凭证 → 演示模式
  if (!appId || !apiKey) return recognizeDemo();

  try {
    // 解码 base64 音频
    const audioBytes = Buffer.from(audioBase64, 'base64');
    if (audioBytes.length > 2 * 1024 * 1024) {
      return { song: null, confidence: 0, mode: 'xf', error: '音频过大（>2MB），请缩短录音时间' };
    }

    // 构建讯飞鉴权参数
    const curTime = String(Math.floor(Date.now() / 1000));
    const paramJson = JSON.stringify({ engine_type: 'afs', aue: 'raw', sample_rate: '16000' });
    const xParam = Buffer.from(paramJson).toString('base64');
    const checkSum = crypto.createHash('md5').update(apiKey + curTime + xParam).digest('hex');

    // 请求讯飞 API
    const res = await request('POST', 'https://webqbh.xfyun.cn/v1/service/v1/qbh', {
      headers: {
        'X-Appid': appId,
        'X-CurTime': curTime,
        'X-Param': xParam,
        'X-CheckSum': checkSum,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': audioBytes.length
      },
      body: audioBytes
    });

    const json = safeJSON(res.body) || {};
    if (json.code !== '0' || !json.data || !json.data.length) {
      return { song: null, confidence: 0, mode: 'xf', error: json.desc || `讯飞返回错误码 ${json.code}` };
    }

    // 取第一个匹配结果，在冈易云搜索同名歌曲
    const hit = json.data[0];
    const searchRes = await search(hit.song + ' ' + (hit.singer || ''), 1, 1);
    const song = searchRes.songs && searchRes.songs[0];
    return {
      song: song || null,
      confidence: 92,
      mode: 'xf',
      raw: { song: hit.song, singer: hit.singer, song_id: hit.song_id }
    };
  } catch (e) {
    return { song: null, confidence: 0, mode: 'xf', error: e.message || '讯飞 API 调用失败' };
  }
}

/**
 * ACRCloud 听歌识曲（identify-cn-north-1）
 * 文档：POST https://identify-cn-north-1.acrcloud.cn/v1/identify
 * Content-Type: multipart/form-data
 * 签名: base64(HMAC-SHA1(access_secret, "POST\n/v1/identify\n"+access_key+"\naudio\n1\n"+timestamp))
 * 零依赖：手动构造 multipart body（Buffer 拼接），不用 FormData
 */
async function recognizeACR(audioBytes, acrAccessKey, acrAccessSecret) {
  if (!acrAccessKey || !acrAccessSecret) return recognizeDemo();
  if (!audioBytes || !audioBytes.length) {
    return { song: null, confidence: 0, mode: 'acr', error: '无音频数据' };
  }
  if (audioBytes.length > 1024 * 1024) {
    return { song: null, confidence: 0, mode: 'acr', error: '音频过大（>1MB），请缩短录音至 12 秒内' };
  }

  try {
    const data_type = 'audio';
    const signature_version = '1';
    const timestamp = String(Math.floor(Date.now() / 1000));

    // 计算签名
    const stringToSign = `POST\n/v1/identify\n${acrAccessKey}\n${data_type}\n${signature_version}\n${timestamp}`;
    const signature = crypto.createHmac('sha1', acrAccessSecret).update(stringToSign, 'utf8').digest('base64');

    // 手动构造 multipart/form-data
    const boundary = '----acrboundary' + crypto.randomBytes(8).toString('hex');
    const CRLF = '\r\n';
    const parts = [];

    function pushField(name, value) {
      parts.push(Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}` +
        `${value}${CRLF}`,
        'utf8'
      ));
    }
    pushField('access_key', acrAccessKey);
    pushField('sample_bytes', String(audioBytes.length));
    pushField('timestamp', timestamp);
    pushField('data_type', data_type);
    pushField('signature_version', signature_version);
    pushField('signature', signature);
    // 音频二进制
    parts.push(Buffer.from(
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="sample"; filename="sample.wav"${CRLF}` +
      `Content-Type: application/octet-stream${CRLF}${CRLF}`,
      'utf8'
    ));
    parts.push(audioBytes);
    parts.push(Buffer.from(CRLF + `--${boundary}--${CRLF}`, 'utf8'));
    const body = Buffer.concat(parts);

    // 发起请求
    const res = await request('POST', 'https://identify-cn-north-1.acrcloud.cn/v1/identify', {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      body
    });

    const json = safeJSON(res.body) || {};
    if (!json.status || json.status.code !== 0) {
      const msg = (json.status && json.status.msg) || `ACRCloud 返回错误码 ${json.status && json.status.code}`;
      return { song: null, confidence: 0, mode: 'acr', error: msg, raw: json };
    }

    const musicList = (json.metadata && json.metadata.music) || [];
    if (!musicList.length) {
      return { song: null, confidence: 0, mode: 'acr', error: '未识别到歌曲', raw: json };
    }
    const hit = musicList[0];
    const title = hit.title || '';
    const artists = (hit.artists || []).map((a) => a.name).filter(Boolean).join(' ');
    const album = (hit.album && hit.album.name) || '';

    // 在冈易云搜索同名歌曲，normalize 后返回
    const kw = (title + ' ' + artists).trim();
    let song = null;
    if (kw) {
      const searchRes = await search(kw, 1, 1);
      song = (searchRes.songs && searchRes.songs[0]) || null;
    }
    return {
      song,
      confidence: Math.min(99, Math.round((hit.score || 80) / 10) + 10),
      mode: 'acr',
      raw: { title, artists, album, acrid: hit.acr_id, external: hit.external_metadata || {} }
    };
  } catch (e) {
    return { song: null, confidence: 0, mode: 'acr', error: e.message || 'ACRCloud API 调用失败' };
  }
}

/** 演示模式：从热歌榜加权随机抽取 */
let _hotSongsCache = null;
let _hotSongsExpire = 0;
async function recognizeDemo() {
  const now = Date.now();
  if (!_hotSongsCache || now > _hotSongsExpire) {
    try {
      const pl = await getPlaylist('3778678');
      _hotSongsCache = (pl.songs || []).filter((s) => s && s.songId);
      _hotSongsExpire = now + 10 * 60 * 1000;
    } catch (e) {
      _hotSongsCache = [];
    }
  }
  const pool = _hotSongsCache && _hotSongsCache.length ? _hotSongsCache : [];
  if (!pool.length) return { song: null, confidence: 0, mode: 'demo', error: '暂无可用歌曲库' };
  const weights = pool.map((_, i) => 1 / (i + 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  let idx = 0;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break; } }
  const song = pool[idx];
  const confidence = 78 + Math.random() * 21.6;
  return { song, confidence: Number(confidence.toFixed(2)), mode: 'demo', note: '演示模式：未配置讯飞 API 凭证，结果为热歌榜加权抽取。' };
}

/** Admin：服务器运行统计（公开只读，无需鉴权，但只有 admin1 解锁后前端才显示） */
function getAdminStats() {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.floor((Date.now() - serverStats.startedAt) / 1000),
    nodeVersion: process.version,
    platform: process.platform,
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024)
    },
    requests: serverStats.requests,
    errors: serverStats.errors,
    recognizeHistory: serverStats.recognizeHistory.slice(-20).reverse(),
    pid: process.pid
  };
}

// 榜单 ID（推荐页）
const CHART_IDS = {
  hot: 3778678,       // 云音乐热歌榜
  new: 3779629,       // 云音乐新歌榜
  rise: 19723756,     // 云音乐飙升榜
  origin: 2884035     // 云音乐原创榜
};

// ---------- 静态文件服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const filePath = path.join(PUBLIC_DIR, p);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

function sendJSON(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** 读取请求体（限制 5MB，避免大音频压垮服务器） */
function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); return reject(new Error('body too large')); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- 路由 ----------
// 导出请求处理器：本地 http 服务器与 Vercel Serverless 函数共用
export async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const pathname = u.pathname;

  if (pathname.startsWith('/api/')) {
    countReq(true, pathname === '/api/recognize');
    try {
      if (pathname === '/api/search') {
        const keyword = u.searchParams.get('keyword') || '';
        const limit = parseInt(u.searchParams.get('limit') || '30', 10);
        const page = parseInt(u.searchParams.get('page') || '1', 10);
        if (!keyword.trim()) return sendJSON(res, { error: 'keyword required' }, 400);
        const platform = u.searchParams.get('platform') || 'all'; // all|netease|kugou|qq
        const perPlatform = Math.ceil(limit / 3);
        const tasks = [];
        if (platform === 'all' || platform === 'netease') tasks.push(search(keyword, perPlatform, page).then(r => r.songs).catch(() => []));
        if (platform === 'all' || platform === 'kugou') tasks.push(searchKugou(keyword, perPlatform, page).then(r => r.songs).catch(() => []));
        if (platform === 'all' || platform === 'qq') tasks.push(searchQQ(keyword, perPlatform, page).then(r => r.songs).catch(() => []));
        const arrays = await Promise.all(tasks);
        const maxLen = Math.max(...arrays.map(a => a.length));
        const results = [];
        for (let i = 0; i < maxLen; i++) for (const arr of arrays) if (i < arr.length) results.push(arr[i]);
        return sendJSON(res, { total: results.length, songs: results });
      }
      if (pathname === '/api/song/detail') {
        const ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean).map((x) => parseInt(x, 10));
        return sendJSON(res, { songs: await getSongDetail(ids) });
      }
      if (pathname === '/api/song/url') {
        const id = u.searchParams.get('id');
        const vendor = u.searchParams.get('vendor') || 'netease';
        const name = u.searchParams.get('name') || '';
        if (!id) return sendJSON(res, { error: 'id required' }, 400);
        let url = '';
        if (vendor === 'kugou') url = await getKugouUrl(id, u.searchParams.get('albumId'));
        else if (vendor === 'qq') url = await getQQUrl(id);
        else url = getSongUrl(id);
        // 回退：非网易源取不到 URL → 按歌名搜网易
        if (!url && name && vendor !== 'netease') {
          try {
            const results = await search(name, 5);
            const match = results.songs.find(s => s.name === name) || results.songs[0];
            if (match) { url = getSongUrl(match.songId); return sendJSON(res, { url, vendor: 'netease', fallback: true }); }
          } catch (e) {}
        }
        return sendJSON(res, { url, vendor });
      }
      if (pathname === '/api/song/check') {
        const url = u.searchParams.get('url');
        if (!url) return sendJSON(res, { error: 'url required' }, 400);
        try {
          const check = await request('HEAD', url, { headers: COMMON_HEADERS });
          return sendJSON(res, { playable: check.status === 200, status: check.status });
        } catch (e) {
          return sendJSON(res, { playable: false, error: e.message });
        }
      }
      if (pathname === '/api/playlist/detail') {
        const id = u.searchParams.get('id');
        if (!id) return sendJSON(res, { error: 'id required' }, 400);
        return sendJSON(res, await getPlaylist(id));
      }
      if (pathname === '/api/playlist/top') {
        const limit = parseInt(u.searchParams.get('limit') || '12', 10);
        return sendJSON(res, { playlists: await getTopPlaylists(limit) });
      }
      if (pathname === '/api/chart') {
        const key = u.searchParams.get('type') || 'hot';
        const id = CHART_IDS[key] || CHART_IDS.hot;
        // 三平台并行取榜，交织返回
        const tasks = [
          getPlaylist(id).then(r => r.songs || []).catch(() => []),
          chartKugou(10).catch(() => []),
          chartQQ(10).catch(() => [])
        ];
        const arrays = await Promise.all(tasks);
        const maxLen = Math.max(...arrays.map(a => a.length));
        const merged = [];
        for (let i = 0; i < maxLen; i++) for (const arr of arrays) if (i < arr.length) merged.push(arr[i]);
        return sendJSON(res, { songs: merged, total: merged.length });
      }
      if (pathname === '/api/lyric') {
        const id = u.searchParams.get('id');
        if (!id) return sendJSON(res, { error: 'id required' }, 400);
        return sendJSON(res, await getLyric(id));
      }
      if (pathname === '/api/recognize') {
        // POST 请求体：{ audio: base64, appId, apiKey, acrAccessKey, acrAccessSecret }
        // 路由：acrAccessKey+acrAccessSecret → ACRCloud；appId+apiKey → 讯飞；否则演示模式
        // 兼容旧版无音频 GET 请求 → 演示模式
        let audioBase64 = '';
        let appId = process.env.XF_APP_ID || '';
        let apiKey = process.env.XF_API_KEY || '';
        let acrAccessKey = process.env.ACR_ACCESS_KEY || '';
        let acrAccessSecret = process.env.ACR_ACCESS_SECRET || '';
        if (req.method === 'POST') {
          const raw = await readBody(req);
          const body = safeJSON(raw) || {};
          audioBase64 = body.audio || '';
          if (body.appId) appId = body.appId;
          if (body.apiKey) apiKey = body.apiKey;
          if (body.acrAccessKey) acrAccessKey = body.acrAccessKey;
          if (body.acrAccessSecret) acrAccessSecret = body.acrAccessSecret;
        }
        let result;
        if (acrAccessKey && acrAccessSecret) {
          const audioBytes = Buffer.from(audioBase64, 'base64');
          result = await recognizeACR(audioBytes, acrAccessKey, acrAccessSecret);
        } else {
          result = await recognizeHumming(audioBase64, appId, apiKey);
        }
        if (result.song) {
          serverStats.recognizeHistory.push({
            at: new Date().toISOString(),
            songId: result.song.songId,
            name: result.song.name,
            artist: (result.song.artists || []).map((a) => a.name).join('/'),
            confidence: result.confidence,
            mode: result.mode || ''
          });
          if (serverStats.recognizeHistory.length > 200) serverStats.recognizeHistory.shift();
        }
        return sendJSON(res, result);
      }
      if (pathname === '/api/admin/stats') {
        return sendJSON(res, getAdminStats());
      }
      return sendJSON(res, { error: 'not found' }, 404);
    } catch (e) {
      serverStats.errors++;
      return sendJSON(res, { error: e.message || 'server error' }, 500);
    }
  }
  countReq(false, false);
  return serveStatic(req, res);
}

// 仅在本地直接运行 node server.js 时监听端口；
// 被 Vercel 函数 import 时不启动监听
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = http.createServer(handler);
  server.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      }
    }
    console.log(`\n  ♪ 开源音乐 已启动`);
    console.log(`  ➜  本机访问:   http://localhost:${PORT}`);
    if (ips.length) {
      console.log(`  ➜  局域网访问: ${ips.map((ip) => `http://${ip}:${PORT}`).join('   ')}`);
      console.log(`  ℹ️  若局域网无法访问，请放行 Windows 防火墙 ${PORT} 端口`);
    }
    console.log('');
  });
}
