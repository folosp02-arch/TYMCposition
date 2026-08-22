/**
 * TDX 桃園捷運(TYMC)資料測試抓取程式
 * ------------------------------------------------
 * 用途:向TDX換取Access Token,再呼叫桃園捷運相關API,
 *       把結果存成本地JSON檔,方便先確認資料長相。
 *
 * 使用方式:
 *   1. 需要 Node.js 18 以上(內建 fetch,不用額外安裝套件)
 *   2. 在終端機設定環境變數後執行:
 *
 *      TDX_CLIENT_ID=你的ClientId TDX_CLIENT_SECRET=你的ClientSecret node tdx-tymc-fetch.js
 *
 *      (Windows PowerShell 用法:)
 *      $env:TDX_CLIENT_ID="你的ClientId"
 *      $env:TDX_CLIENT_SECRET="你的ClientSecret"
 *      node tdx-tymc-fetch.js
 *
 *   千萬不要把 Client Secret 寫死在程式碼裡再上傳到公開的 GitHub。
 * ------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const CLIENT_ID = process.env.TDX_CLIENT_ID;
const CLIENT_SECRET = process.env.TDX_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('請先設定環境變數 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET 再執行。');
  process.exit(1);
}

const AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const API_BASE = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';
const RAIL_SYSTEM = 'TYMC'; // 桃園捷運

// 這次要測試的端點清單:key 是輸出檔名,value 是API路徑
const ENDPOINTS = {
  'stationOfLine':      `${API_BASE}/StationOfLine/${RAIL_SYSTEM}`,
  's2sTravelTime':       `${API_BASE}/S2STravelTime/${RAIL_SYSTEM}`,
  'firstLastTimetable':  `${API_BASE}/FirstLastTimetable/${RAIL_SYSTEM}`,
  'frequency':           `${API_BASE}/Frequency/${RAIL_SYSTEM}`,
  'route':               `${API_BASE}/Route/${RAIL_SYSTEM}`,
  'stationOfRoute':      `${API_BASE}/StationOfRoute/${RAIL_SYSTEM}`,
};

const OUTPUT_DIR = path.join(__dirname, 'tdx-output');

/** 用 Client Credentials 流程換取 Access Token */
async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`取得Token失敗 (HTTP ${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token; // 有效期限見 data.expires_in(秒),通常是1天
}

/** 睡眠指定毫秒數,用來在呼叫之間留間隔、或429重試前等待 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 呼叫單一API,回傳解析後的JSON;碰到429會自動等待後重試 */
async function fetchApi(url, token, retriesLeft = 3) {
  const res = await fetch(`${url}?%24format=JSON`, {
    headers: {
      authorization: `Bearer ${token}`,
      'accept-encoding': 'gzip', // 官方建議帶,可縮小回傳資料量
    },
  });

  if (res.status === 429 && retriesLeft > 0) {
    const waitMs = 3000; // 碰到頻率限制,先等3秒再重試
    console.log(`  (碰到429頻率限制,等待 ${waitMs / 1000} 秒後重試...剩餘重試次數 ${retriesLeft})`);
    await sleep(waitMs);
    return fetchApi(url, token, retriesLeft - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`呼叫失敗 (HTTP ${res.status}): ${url}\n${text}`);
  }

  return res.json();
}

async function main() {
  console.log('正在向 TDX 換取 Access Token...');
  const token = await getAccessToken();
  console.log('Token 取得成功,開始逐一呼叫API...\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const CALL_INTERVAL_MS = 800; // 每支API呼叫之間的間隔,避免觸發頻率限制

  let first = true;
  for (const [name, url] of Object.entries(ENDPOINTS)) {
    if (!first) await sleep(CALL_INTERVAL_MS);
    first = false;

    try {
      const data = await fetchApi(url, token);
      const outPath = path.join(OUTPUT_DIR, `${name}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

      const count = Array.isArray(data) ? data.length : 1;
      console.log(`✓ ${name}: 取得 ${count} 筆資料(頂層) → 已存到 tdx-output/${name}.json`);
    } catch (err) {
      console.error(`✗ ${name} 失敗: ${err.message}`);
    }
  }

  console.log('\n全部完成。可以打開 tdx-output/ 資料夾裡的 JSON 檔案,先確認欄位長相。');
}

main().catch(err => {
  console.error('程式執行發生錯誤:', err.message);
  process.exit(1);
});
