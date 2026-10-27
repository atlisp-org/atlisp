// 抖音开放平台官方 API：OAuth 授权 + 视频上传 + 创建视频
//
// 前提（重要）：
//   - 开发者主体须为「企业」（个人开发者无法开通发布能力）
//   - 控制台 > 应用详情 > 能力管理 > 能力实验室 > 申请「代替用户发布内容到抖音」
//   - 用户通过 OAuth 授权（scope 含 video.create）
//
// 接口文档: https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, abs, log } from './common.js';

const API = 'https://open.douyin.com';

// 接口地址（与官方文档一致；如控制台文档有出入，改这里即可）
const EP = {
  token: `${API}/oauth/access_token/`,
  refresh: `${API}/oauth/refresh_token/`,
  upload: `${API}/api/douyin/v1/video/upload_video/`,
  initPart: `${API}/api/douyin/v1/video/init_video_part_upload/`,
  uploadPart: `${API}/api/douyin/v1/video/upload_video_part/`,
  finishPart: `${API}/api/douyin/v1/video/finish_video_part_upload/`,
  create: `${API}/api/douyin/v1/video/create_video/`,
};

// ---------- HTTP 工具 ----------

async function postForm(url, obj) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(obj),
  });
  return res.json();
}

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function postMultipart(url, form, headers) {
  const res = await fetch(url, { method: 'POST', headers, body: form });
  return res.json();
}

// ---------- OAuth ----------

/** 构造 OAuth 授权页 URL（用户扫码/登录授权） */
export function buildAuthUrl({ appKey, redirectUri, scope = 'user_info,video.create', state = 'autopost' }) {
  const q = new URLSearchParams({
    client_key: appKey,
    response_type: 'code',
    scope,
    redirect_uri: redirectUri,
    state,
    prompt: 'consent',
  });
  return `${API}/platform/oauth/connect/?${q}`;
}

/** 授权码换 access_token */
export async function codeForToken({ appKey, appSecret, code }) {
  const data = await postForm(EP.token, {
    client_key: appKey,
    client_secret: appSecret,
    code,
    grant_type: 'authorization_code',
  });
  if (!data.access_token) throw new Error(`获取 access_token 失败: ${JSON.stringify(data)}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    openId: data.open_id || '',
    scope: data.scope || '',
    obtainedAt: Date.now(),
    expiresAt: Date.now() + (data.expires_in || 15 * 86400) * 1000,
    refreshExpiresAt: Date.now() + (data.refresh_expires_in || 30 * 86400) * 1000,
  };
}

/** refresh_token 换新 access_token */
export async function refreshAccessToken({ appKey, appSecret, refreshToken, file }) {
  const data = await postForm(EP.refresh, {
    client_key: appKey,
    client_secret: appSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!data.access_token) throw new Error(`刷新 token 失败: ${JSON.stringify(data)}`);
  const prev = loadToken(file) || {};
  const t = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    openId: data.open_id || prev.openId || '',
    scope: data.scope || prev.scope || '',
    obtainedAt: Date.now(),
    expiresAt: Date.now() + (data.expires_in || 15 * 86400) * 1000,
    refreshExpiresAt: Date.now() + (data.refresh_expires_in || 30 * 86400) * 1000,
  };
  saveToken(file, t);
  return t;
}

export function loadToken(file) {
  const f = abs(file);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function saveToken(file, token) {
  const f = abs(file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(token, null, 2));
  log(`[douyin-api] token 已保存: ${f} (open_id=${token.openId})`);
}

/** 取有效 token，过期自动刷新 */
export async function getValidToken(apiCfg) {
  const file = apiCfg.tokenFile || 'state/douyin-token.json';
  const t = loadToken(file);
  if (!t) throw new Error('未找到抖音 token，请先运行: npm run douyin-oauth 完成授权');
  if (t.expiresAt > Date.now() + 60000) return t;
  if (!t.refreshToken) throw new Error('token 已过期且无 refresh_token，请重新运行: npm run douyin-oauth');
  log('[douyin-api] access_token 已过期，自动刷新...');
  return refreshAccessToken({
    appKey: apiCfg.appKey,
    appSecret: apiCfg.appSecret,
    refreshToken: t.refreshToken,
    file,
  });
}

// ---------- 视频上传 ----------

/** 直接上传视频文件（≤300MB）→ 加密 video_id */
export async function uploadVideo({ token, openId, file }) {
  const f = abs(file);
  if (!fs.existsSync(f)) throw new Error(`视频文件不存在: ${f}`);
  const size = fs.statSync(f).size;
  if (size > 300 * 1024 * 1024) throw new Error(`文件 ${size / 1024 / 1024}MB 超过 300MB，请改用 uploadVideoParts()`);
  const form = new FormData();
  form.append('video', new Blob([fs.readFileSync(f)]), path.basename(f));
  const data = await postMultipart(`${EP.upload}?open_id=${openId}`, form, {
    'access-token': token.accessToken,
  });
  const videoId = data?.data?.video?.video_id || data?.data?.video_id;
  if (!videoId) throw new Error(`视频上传失败: ${JSON.stringify(data)}`);
  log(`[douyin-api] 视频上传完成: ${videoId}`);
  return videoId;
}

/**
 * 分片上传（>50MB 建议，>300MB 必须；单片 5~100MB，默认 20MB）
 * 流程: init_video_part_upload → upload_video_part × N → finish_video_part_upload
 */
export async function uploadVideoParts({ token, openId, file, partSize = 20 * 1024 * 1024 }) {
  const f = abs(file);
  if (!fs.existsSync(f)) throw new Error(`视频文件不存在: ${f}`);
  const buf = fs.readFileSync(f);
  const total = Math.max(1, Math.ceil(buf.length / partSize));

  // 1) 初始化
  const init = await postJson(`${EP.initPart}?open_id=${openId}`, {}, {
    'access-token': token.accessToken,
  });
  const uploadId = init?.data?.upload_id;
  if (!uploadId) throw new Error(`分片上传初始化失败: ${JSON.stringify(init)}`);

  // 2) 逐片上传
  for (let i = 0; i < total; i++) {
    const form = new FormData();
    form.append('video', new Blob([buf.subarray(i * partSize, (i + 1) * partSize)]), path.basename(f));
    const part = await postMultipart(
      `${EP.uploadPart}?open_id=${openId}&upload_id=${encodeURIComponent(uploadId)}&part_number=${i + 1}`,
      form,
      { 'access-token': token.accessToken },
    );
    if (part?.data?.error_code !== 0) throw new Error(`分片 ${i + 1}/${total} 上传失败: ${JSON.stringify(part)}`);
    log(`[douyin-api] 分片 ${i + 1}/${total} 已上传`);
  }

  // 3) 完成
  const form = new FormData();
  form.append('upload_id', uploadId);
  const finish = await postMultipart(`${EP.finishPart}?open_id=${openId}`, form, {
    'access-token': token.accessToken,
  });
  const videoId = finish?.data?.video?.video_id || finish?.data?.video_id;
  if (!videoId) throw new Error(`分片上传完成失败: ${JSON.stringify(finish)}`);
  log(`[douyin-api] 分片上传完成: ${videoId}`);
  return videoId;
}

// ---------- 创建视频 ----------

/**
 * 创建抖音视频
 * @param {string} text 标题，≤1000 字，可带 #话题 和 @用户
 * @param {number} [privateStatus] 0 公开 / 1 仅自己 / 2 好友
 */
export async function createVideo({ token, openId, videoId, text, privateStatus = 0, coverTsp }) {
  const body = {
    video_id: videoId,
    text: (text || '').slice(0, 1000),
    private_status: privateStatus,
  };
  if (coverTsp !== undefined) body.cover_tsp = coverTsp;
  const data = await postJson(`${EP.create}?open_id=${openId}`, body, {
    'access-token': token.accessToken,
  });
  const code = data?.data?.error_code ?? data?.extra?.error_code;
  if (code !== 0) throw new Error(`创建视频失败: ${JSON.stringify(data)}`);
  return { awemeId: data?.data?.video_id || data?.data?.item_id || '', raw: data };
}

/**
 * 完整发布流程：上传 → 创建
 * @param {object} p
 * @param {string} p.file 本地视频路径
 * @param {string} [p.title] 标题
 * @param {string[]} [p.topics] 话题（自动加 #）
 * @param {number} [p.privateStatus] 0 公开 / 1 仅自己 / 2 好友
 */
export async function publishVideo({ file, title = '', topics = [], privateStatus = 0 }) {
  const apiCfg = loadConfig().douyin?.api || {};
  const token = await getValidToken(apiCfg);
  log(`[douyin-api] 上传视频: ${file}`);
  const size = fs.statSync(abs(file)).size;
  const videoId =
    size > 50 * 1024 * 1024
      ? await uploadVideoParts({ token, openId: token.openId, file })
      : await uploadVideo({ token, openId: token.openId, file });
  const text = [title, ...topics.map((t) => (t.startsWith('#') ? t : `#${t}`))].join(' ').slice(0, 1000);
  const r = await createVideo({ token, openId: token.openId, videoId, text, privateStatus });
  log(`[douyin-api] 发布成功（进入平台审核）: ${r.awemeId}`);
  return r;
}
