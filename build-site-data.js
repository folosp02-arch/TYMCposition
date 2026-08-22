/**
 * 把 tdx-output/ 裡的原始資料,轉換成模擬網頁可直接使用的 site-data.js
 * ------------------------------------------------
 * 使用方式:先跑過 tdx-tymc-fetch.js 產生 tdx-output/ 資料夾,
 *          再執行: node build-site-data.js
 * ------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'tdx-output');

function load(name) {
  const p = path.join(DIR, `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`找不到 ${p},請先執行 tdx-tymc-fetch.js`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/* ---------- 1. 站點資料 ---------- */
const stationOfLine = load('stationOfLine');
const lineData = stationOfLine[0]; // 目前只有一條線(LineID: A)

const stations = lineData.Stations
  .slice()
  .sort((a, b) => a.Sequence - b.Sequence)
  .map(s => ({
    code: s.StationID,
    name: s.StationName.Zh_tw,
    seq: s.Sequence,
    km: s.CumulativeDistance,
  }));

const seqByCode = {};
stations.forEach(s => { seqByCode[s.code] = s.seq; });

/* ---------- 2. 站間時間(依 TrainType 分組) ---------- */
const s2s = load('s2sTravelTime');

function getMatrix(trainType) {
  const group = s2s.find(g => g.TrainType === trainType);
  if (!group) throw new Error(`s2sTravelTime 裡找不到 TrainType=${trainType} 的資料`);
  return group.TravelTimes;
}

function fillNulls(segments, label) {
  const known = segments.filter(v => v !== null);
  if (known.length === 0) return segments;
  const avg = Math.round(known.reduce((a, b) => a + b, 0) / known.length);
  return segments.map((v, i) => {
    if (v === null) {
      console.warn(`⚠️ ${label} 第${i + 1}段缺資料,用平均值 ${avg}秒 補上`);
      return avg;
    }
    return v;
  });
}

// 普通車:只取「相鄰站序」的區間
const localMatrix = getMatrix(1);
let localSegments = [];
for (let i = 0; i < stations.length - 1; i++) {
  const fromCode = stations[i].code, toCode = stations[i + 1].code;
  const entry = localMatrix.find(t => t.FromStationID === fromCode && t.ToStationID === toCode);
  localSegments.push(entry ? entry.RunTime + entry.StopTime : null);
}
localSegments = fillNulls(localSegments, '普通車');

// 直達車:先找出所有出現過的站,依真實站序排序,當作停靠站清單
const expressMatrix = getMatrix(2);
const expressStops = [...new Set(
  expressMatrix.flatMap(t => [t.FromStationID, t.ToStationID])
)].sort((a, b) => seqByCode[a] - seqByCode[b]);

let expressSegments = [];
for (let i = 0; i < expressStops.length - 1; i++) {
  const fromCode = expressStops[i], toCode = expressStops[i + 1];
  const entry = expressMatrix.find(t => t.FromStationID === fromCode && t.ToStationID === toCode);
  expressSegments.push(entry ? entry.RunTime + entry.StopTime : null);
}
expressSegments = fillNulls(expressSegments, '直達車');

/* ---------- 3. 班距與營運時間 ---------- */
const freq = load('frequency');
const mainFreq = freq[0]; // 目前只有A-1這條主線資料
const headwayMins = mainFreq.Headways[0].MinHeadwayMins;
const serviceStart = mainFreq.OperationTime.StartTime; // 例如 "05:30"
const serviceEnd = mainFreq.OperationTime.EndTime;     // 例如 "00:28"(代表跨日凌晨)

/* ---------- 輸出 ---------- */
const siteData = {
  generatedAt: new Date().toISOString(),
  stations,
  localSegments,
  expressStops,
  expressSegments,
  headwayMins,
  serviceStart,
  serviceEnd,
};

const outPath = path.join(__dirname, 'site-data.js');
fs.writeFileSync(
  outPath,
  `// 由 build-site-data.js 自動產生,請勿手動編輯\n` +
  `// 產生時間: ${siteData.generatedAt}\n` +
  `const SITE_DATA = ${JSON.stringify(siteData, null, 2)};\n`,
  'utf-8'
);

console.log(`已產生 site-data.js`);
console.log(`- 站點數: ${stations.length}`);
console.log(`- 普通車區間數: ${localSegments.length}`);
console.log(`- 直達車停靠站(${expressStops.length}站): ${expressStops.join(', ')}`);
console.log(`- 直達車區間數: ${expressSegments.length}`);
console.log(`- 班距: ${headwayMins} 分鐘`);
console.log(`- 營運時間: ${serviceStart} - ${serviceEnd}`);
