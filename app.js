/* ============================================================
   朗讀文章 App — 核心邏輯
   重點一：文字整理 + 斷句（控制停頓位置）
   重點二：說故事模式 — 區分「對話」與「旁白」，用不同聲音唸
   ============================================================ */

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const inputView   = $('inputView');
const readView    = $('readView');
const inputText   = $('inputText');
const cleanBtn    = $('cleanBtn');
const clearBtn    = $('clearBtn');
const backBtn     = $('backBtn');
const sentencesEl = $('sentences');
const sentenceCount = $('sentenceCount');
const playBtn  = $('playBtn');
const pauseBtn = $('pauseBtn');
const stopBtn  = $('stopBtn');
const rate     = $('rate');
const rateVal  = $('rateVal');
const voiceSelect = $('voiceSelect');
const dialogueVoiceSelect = $('dialogueVoiceSelect');
const dialogueVoiceWrap   = $('dialogueVoiceWrap');
const storyMode = $('storyMode');
const pauseLen = $('pauseLen');
const pauseVal = $('pauseVal');
const hint     = $('hint');
const hqMode        = $('hqMode');
const browserVoices = $('browserVoices');
const azureVoices   = $('azureVoices');
const azureNarSelect = $('azureNarSelect');
const azureDlgSelect = $('azureDlgSelect');
const azureDlgWrap   = $('azureDlgWrap');
const narStyle = $('narStyle');
const dlgStyle = $('dlgStyle');
const prepEl   = $('prep');
const quotaEl  = $('quota');
const saveTitle   = $('saveTitle');
const saveBtn     = $('saveBtn');
const preloadBtn  = $('preloadBtn');
const libraryList = $('libraryList');

// 可選的 AI 聲音
const AZURE_VOICES = [
  { v: 'zh-TW-HsiaoChenNeural', label: '曉臻（女・台灣）' },
  { v: 'zh-TW-YunJheNeural',    label: '雲哲（男・台灣）' },
  { v: 'zh-TW-HsiaoYuNeural',   label: '曉雨（女・台灣）' },
  { v: 'zh-CN-XiaoxiaoNeural',  label: '曉曉（女・大陸・可情緒）' },
  { v: 'zh-CN-YunxiNeural',     label: '雲希（男・大陸・可情緒）' },
  { v: 'zh-CN-YunjianNeural',   label: '雲健（男・大陸・戲劇感）' },
  { v: 'zh-CN-XiaomoNeural',    label: '曉墨（女・大陸・可情緒）' },
  { v: 'zh-CN-XiaoyiNeural',    label: '曉伊（女・大陸）' },
  { v: 'zh-CN-YunyangNeural',   label: '雲揚（男・大陸・播報感）' },
];

// 情緒／語氣（只對大陸腔聲音有效）
const AZURE_STYLES = [
  { v: 'general',           label: '自然（無情緒）' },
  { v: 'gentle',            label: '溫柔' },
  { v: 'cheerful',          label: '開心' },
  { v: 'sad',               label: '悲傷' },
  { v: 'serious',           label: '嚴肅' },
  { v: 'angry',             label: '生氣' },
  { v: 'narration-relaxed', label: '說書（放鬆）' },
  { v: 'chat',              label: '聊天' },
];

// 雲端 AI 語音代理（Cloudflare Worker）
const WORKER_URL = 'https://tts.kchill.workers.dev';
const hqAudio = new Audio();
const memCache = new Map();        // 本次開啟期間的音檔快取（記憶體）
let hqUnlocked = false;
let programmaticPause = false;   // 區分「程式主動暫停」與「被系統打斷」
// 一小段無聲音檔，用來在 iPhone 上「解鎖」自動播放
const SILENT = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';

// ---------- 狀態 ----------
let sentences = [];   // [{ segments:[{text,type}], fullText, paraGap }]
let units = [];       // 實際朗讀單位 [{ text, type, sIdx }]
let sentFirstUnit = []; // 每句對應的第一個 unit index（點句子用）
let current = -1;     // 目前朗讀到第幾個 unit
let speaking = false;
let paused = false;
let voices = [];
let gapTimer = null;

// 高音質「整條音檔」相關狀態
let hqTrackURL = null;   // 已合成好的整條音檔網址
let hqTrackKey = null;   // 對應的唯一鍵（換文字/聲音就會不同）
let hqTimeline = null;   // 每句的近似起始時間
let preparing = false;   // 是否正在準備（合成）音檔
let lastHiIdx = -1;      // 上次高亮的 unit，避免重複捲動

// 引號：開頭 / 結尾（中文小說常用）
const OPEN_Q  = '「『“〝';
const CLOSE_Q = '」』”〞';

// ============================================================
//  1) 文字整理與斷句
// ============================================================
const END_CHARS = '。！？…!?」』）)】》”"';

function buildSentences(raw){
  let text = raw.replace(/\r\n?/g, '\n').replace(/　/g, ' ');
  const paragraphs = text.split(/\n\s*\n+/);
  const result = [];

  for(const para of paragraphs){
    const lines = para.split('\n').map(l => l.trim()).filter(l => l.length);
    let merged = '';
    for(let i=0;i<lines.length;i++){
      const line = lines[i];
      merged += line;
      const last = line[line.length-1];
      const isEnd = END_CHARS.includes(last);
      if(i < lines.length-1 && !isEnd){
        const next = lines[i+1][0] || '';
        if(/[A-Za-z0-9]/.test(last) && /[A-Za-z0-9]/.test(next)) merged += ' ';
      }
    }

    const paraSentences = splitSentences(merged);
    paraSentences.forEach((s, idx) => {
      const t = s.trim();
      if(!t) return;
      result.push({
        fullText: t,
        segments: parseSegments(t),
        paraGap: idx===0 && result.length>0
      });
    });
  }
  return result;
}

function splitSentences(str){
  const out = [];
  let buf = '';
  let depth = 0;                       // 在引號內時不斷句，避免把對話切開
  for(let i=0;i<str.length;i++){
    const ch = str[i];
    buf += ch;
    if(OPEN_Q.includes(ch)) depth++;
    else if(CLOSE_Q.includes(ch) && depth>0) depth--;

    if(depth===0 && '。！？…!?'.includes(ch)){
      while(i+1 < str.length && '。！？…!?」』）)】》”"'.includes(str[i+1])){
        buf += str[++i];
      }
      out.push(buf);
      buf = '';
    }
  }
  if(buf.trim()) out.push(buf);
  return out;
}

/**
 * 把一句話依引號拆成「旁白」與「對話」小段。
 * 例：他說：「我不去。」我點頭。
 *  → [旁白「他說：」, 對話「「我不去。」」, 旁白「我點頭。」]
 */
function parseSegments(text){
  const segs = [];
  let buf = '';
  let depth = 0;
  for(const ch of text){
    if(OPEN_Q.includes(ch)){
      if(depth===0){
        if(buf.trim()) segs.push({ text:buf, type:'narration' });
        buf = '';
      }
      depth++; buf += ch;
    } else if(CLOSE_Q.includes(ch) && depth>0){
      depth--; buf += ch;
      if(depth===0){
        if(buf.trim()) segs.push({ text:buf, type:'dialogue' });
        buf = '';
      }
    } else {
      buf += ch;
    }
  }
  if(buf.trim()) segs.push({ text:buf, type: depth>0 ? 'dialogue' : 'narration' });
  return segs.length ? segs : [{ text:text, type:'narration' }];
}

// ============================================================
//  2) 建立朗讀單位 + 顯示預覽
// ============================================================
function buildUnitsFrom(sents, story){
  const arr = [];
  sents.forEach((s, sIdx) => {
    const segs = story ? s.segments : [{ text:s.fullText, type:'narration' }];
    segs.forEach(seg => {
      if(seg.text.trim()) arr.push({ text:seg.text, type:seg.type, sIdx });
    });
  });
  return arr;
}

function buildUnits(){
  const story = storyMode.checked;
  units = buildUnitsFrom(sentences, story);
  sentFirstUnit = [];
  let idx = 0;
  sentences.forEach((s, sIdx) => {
    sentFirstUnit[sIdx] = idx;
    const segs = story ? s.segments : [{ text:s.fullText, type:'narration' }];
    segs.forEach(seg => { if(seg.text.trim()) idx++; });
  });
}

function renderSentences(){
  const story = storyMode.checked;
  sentencesEl.innerHTML = '';
  sentences.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'sentence' + (s.paraGap ? ' para-gap' : '');
    div.dataset.i = i;
    if(story){
      s.segments.forEach(seg => {
        const span = document.createElement('span');
        span.className = seg.type === 'dialogue' ? 'seg-dlg' : 'seg-nar';
        span.textContent = seg.text;
        div.appendChild(span);
      });
    } else {
      div.textContent = s.fullText;
    }
    div.addEventListener('click', () => startFrom(sentFirstUnit[i]));
    sentencesEl.appendChild(div);
  });
  const dlgCount = sentences.reduce((n,s)=> n + s.segments.filter(x=>x.type==='dialogue').length, 0);
  sentenceCount.textContent = story
    ? `共 ${sentences.length} 句 · ${dlgCount} 段對話（點句子可從那裡開始）`
    : `共 ${sentences.length} 句（點句子可從那裡開始）`;
}

function highlight(sIdx){
  const nodes = sentencesEl.children;
  for(const n of nodes) n.classList.remove('active');
  if(sIdx>=0 && nodes[sIdx]){
    nodes[sIdx].classList.add('active');
    nodes[sIdx].scrollIntoView({ block:'center', behavior:'smooth' });
  }
}

// ============================================================
//  3a) 雲端 AI 語音（高音質）— 先合成整條音檔再播放
// ============================================================
function azureVoiceFor(unit){
  return (storyMode.checked && unit.type === 'dialogue')
    ? azureDlgSelect.value : azureNarSelect.value;
}
function azureStyleFor(unit){
  return (storyMode.checked && unit.type === 'dialogue')
    ? dlgStyle.value : narStyle.value;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const escXML = (t) => t.replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// 小型字串雜湊，用來當快取鍵
function hashStr(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i=0;i<str.length;i++){
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1>>>0)).toString(36);
}

// 會自動重試的抓取：網路瞬斷、雲端忙碌(429)、伺服器錯誤(5xx) 都會重試
async function fetchTTS(ssml, tries){
  tries = tries || 3;
  let lastErr;
  for(let i = 0; i < tries; i++){
    try {
      const r = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssml })
      });
      if(r.ok) return r;
      if(r.status !== 429 && r.status < 500) return r;   // 4xx(非429)不重試
      lastErr = new Error('tts ' + r.status);
    } catch(e){ lastErr = e; }
    await sleep(500 * (i + 1));
  }
  throw lastErr || new Error('tts failed');
}

// 依累積字數把 units 切成數段（每段一次跟雲端要）
const MAX_CHUNK_CHARS = 1800;
function buildChunks(us){
  const chunks = []; let cur = []; let n = 0;
  for(const u of us){
    if(n > 0 && n + u.text.length > MAX_CHUNK_CHARS){ chunks.push(cur); cur = []; n = 0; }
    cur.push(u); n += u.text.length;
  }
  if(cur.length) chunks.push(cur);
  return chunks;
}

// 一段（多句）合成一個 SSML：各句用各自的聲音/語氣，句間加停頓
function chunkSSML(chunkUnits, sents){
  const pl = parseInt(pauseLen.value, 10) || 200;
  let body = '';
  chunkUnits.forEach((u, idx) => {
    const voice = azureVoiceFor(u);
    const style = azureStyleFor(u);
    const locale = voice.split('-').slice(0,2).join('-');
    let inner = escXML(u.text);
    if(style && style !== 'general' && locale === 'zh-CN'){
      inner = "<mstts:express-as style='" + style + "'>" + inner + "</mstts:express-as>";
    }
    let gap;
    const next = chunkUnits[idx+1];
    if(next){
      if(next.sIdx !== u.sIdx){ gap = pl; if(sents[next.sIdx] && sents[next.sIdx].paraGap) gap += 300; }
      else gap = 80;
    } else { gap = 250; }
    body += "<voice name='" + voice + "'>" + inner + "<break time='" + gap + "ms'/></voice>";
  });
  return "<speak version='1.0' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='zh-TW'>" +
    body + "</speak>";
}

// 這篇 + 目前聲音設定 的唯一鍵
function trackKeyFor(us){
  const cfg = us.map(u => azureVoiceFor(u) + ':' + azureStyleFor(u) + ':' + u.text).join('|')
            + '|pl=' + pauseLen.value;
  return 't' + hashStr(cfg);
}

async function cachedTrack(key){
  try {
    const c = await caches.open('tts-audio');
    const resp = await c.match('https://tts.track/' + key);
    if(resp) return await resp.blob();
  } catch(e){}
  return null;
}

// 產生整條音檔（會計額度、寫快取），回傳 Blob 或 null
let cancelPrepare = false;
async function generateTrack(us, sents, key, onProgress){
  const chunks = buildChunks(us);
  const blobs = [];
  for(let i=0;i<chunks.length;i++){
    if(cancelPrepare) return null;
    if(onProgress) onProgress(i, chunks.length);
    if(quotaExhausted()){ notifyQuota(); return null; }
    const chunkChars = chunks[i].reduce((s,u)=>s+u.text.length, 0);
    let r;
    try { r = await fetchTTS(chunkSSML(chunks[i], sents)); }
    catch(e){ prepError('⚠️ 網路不穩，準備失敗，請稍後再按播放重試。'); return null; }
    if(r.status === 403 || r.status === 429){ setQuotaExhausted(); notifyQuota(); return null; }
    if(!r.ok){ prepError('⚠️ 語音產生失敗（' + r.status + '），請稍後再試。'); return null; }
    addUsage(chunkChars);
    blobs.push(await r.blob());
  }
  const track = new Blob(blobs, { type: 'audio/mpeg' });
  try {
    const c = await caches.open('tts-audio');
    await c.put('https://tts.track/' + key, new Response(track, { headers:{'Content-Type':'audio/mpeg'} }));
  } catch(e){}
  return track;
}

// 準備目前這篇的音檔（快取優先），設定 hqTrackURL / hqTimeline
async function prepareTrack(){
  const key = trackKeyFor(units);
  if(key === hqTrackKey && hqTrackURL) return true;   // 已準備好
  preparing = true; cancelPrepare = false; setButtons();
  let track = await cachedTrack(key);
  if(!track){
    showPrep(0, buildChunks(units).length);
    track = await generateTrack(units, sentences, key, showPrep);
  }
  preparing = false;
  hidePrep();
  if(!track){ setButtons(); return false; }
  if(hqTrackURL) URL.revokeObjectURL(hqTrackURL);
  hqTrackURL = URL.createObjectURL(track);
  hqTrackKey = key;
  await loadTrackMeta();
  setButtons();
  return true;
}

function loadTrackMeta(){
  return new Promise((res) => {
    hqTimeline = null;
    hqAudio.src = hqTrackURL;
    hqAudio._trackKey = hqTrackKey;
    let done = false;
    const finish = () => { if(done) return; done = true; buildTimeline(hqAudio.duration); res(); };
    hqAudio.addEventListener('loadedmetadata', finish, { once:true });
    setTimeout(finish, 4000);   // 保險
  });
}

// 依字數比例估算每句在整條音檔的起始時間（近似高亮用）
function buildTimeline(dur){
  if(!isFinite(dur) || dur <= 0){ hqTimeline = null; return; }
  const total = units.reduce((s,u)=>s+u.text.length, 0) || 1;
  let acc = 0;
  hqTimeline = units.map(u => {
    const start = acc/total*dur; acc += u.text.length; return { sIdx:u.sIdx, start };
  });
}

function unitAtTime(t){
  if(!hqTimeline) return -1;
  let lo = 0, hi = hqTimeline.length - 1, ans = 0;
  while(lo <= hi){
    const mid = (lo+hi)>>1;
    if(hqTimeline[mid].start <= t){ ans = mid; lo = mid+1; } else hi = mid-1;
  }
  return ans;
}

async function hqPlayFrom(i){
  const ok = await prepareTrack();
  if(!ok){ speaking = false; setButtons(); return; }
  if(!speaking) return;   // 準備期間被停掉
  if(hqAudio._trackKey !== hqTrackKey){ await loadTrackMeta(); }
  const startT = (hqTimeline && hqTimeline[i]) ? hqTimeline[i].start : 0;
  try { hqAudio.currentTime = startT; } catch(e){}
  current = i;
  hqAudio.playbackRate = parseFloat(rate.value);
  programmaticPause = false;
  hqAudio.play().catch(() => {
    setTimeout(() => { if(speaking && !paused) hqAudio.play().catch(()=>{}); }, 250);
  });
  setupMediaSession();
}

// 播放時的近似高亮
hqAudio.addEventListener('timeupdate', () => {
  if(!hqMode.checked || !speaking || paused || !hqTimeline) return;
  const idx = unitAtTime(hqAudio.currentTime);
  if(idx !== lastHiIdx && idx >= 0 && units[idx]){
    lastHiIdx = idx; current = idx; highlight(units[idx].sIdx);
  }
});

hqAudio.onended = () => { if(hqMode.checked && speaking) stopAll(); };

// 被系統打斷（來電、通知聲、其他 App）→ 自動接回
hqAudio.addEventListener('pause', () => {
  if(programmaticPause){ programmaticPause = false; return; }
  if(speaking && !paused && !hqAudio.ended){
    setTimeout(() => {
      if(speaking && !paused && hqAudio.paused && !hqAudio.ended) hqAudio.play().catch(()=>{});
    }, 300);
  }
});

// 鎖定畫面控制
function setupMediaSession(){
  if(!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: '朗讀文章', artist: 'AI 朗讀' });
    navigator.mediaSession.setActionHandler('play', () => play());
    navigator.mediaSession.setActionHandler('pause', () => pause());
  } catch(e){}
}

// ---- 準備進度 UI ----
function showPrep(i, total){
  prepEl.classList.remove('hidden');
  prepEl.textContent = '準備語音中… ' + Math.min(i+1, total) + ' / ' + total;
}
function hidePrep(){ prepEl.classList.add('hidden'); }
function prepError(msg){ hidePrep(); hint.textContent = msg; }

// ---- 額度追蹤（每月 50 萬字免費） ----
const QUOTA_LIMIT = 500000, QUOTA_WARN = 450000;
const monthNow = () => new Date().toISOString().slice(0,7);
function quotaData(){
  let d;
  try { d = JSON.parse(localStorage.getItem('quota') || '{}'); } catch(e){ d = {}; }
  if(d.month !== monthNow()) d = { month: monthNow(), used: 0, exhausted: false };
  return d;
}
function quotaSave(d){ localStorage.setItem('quota', JSON.stringify(d)); }
function addUsage(chars){ const d = quotaData(); d.used += chars; quotaSave(d); renderQuota(); }
function quotaExhausted(){ const d = quotaData(); return !!d.exhausted || d.used >= QUOTA_LIMIT; }
function setQuotaExhausted(){ const d = quotaData(); d.exhausted = true; quotaSave(d); renderQuota(); }
function renderQuota(){
  const d = quotaData();
  quotaEl.textContent = '本月 AI 語音已用約 ' + (d.used/10000).toFixed(1) + ' 萬字 / 50 萬';
  quotaEl.classList.toggle('warn', d.used >= QUOTA_WARN || d.exhausted);
}
function notifyQuota(){
  hint.textContent = '⚠️ 本月免費 AI 語音額度用完了，已暫停。下個月會自動恢復，或先關掉高音質改用免費語音（不會扣到錢）。';
}

// ============================================================
//  3b) 免費手機語音（Web Speech）
// ============================================================
function speakCurrent(){
  if(current < 0 || current >= units.length){ stopAll(); return; }
  const unit = units[current];
  highlight(unit.sIdx);

  const u = new SpeechSynthesisUtterance(unit.text);
  const story = storyMode.checked;
  const isDlg = story && unit.type === 'dialogue';

  // 選聲音
  const narV = voices[voiceSelect.value];
  const dlgV = voices[dialogueVoiceSelect.value] || narV;
  const v = isDlg ? dlgV : narV;
  if(v) u.voice = v;
  u.lang = (v && v.lang) || 'zh-TW';

  u.rate = parseFloat(rate.value) * (isDlg ? 1.05 : 1.0);
  // 若對話與旁白是同一個聲音，就用音調差異來區分
  if(story){
    const sameVoice = dlgV === narV;
    u.pitch = isDlg ? (sameVoice ? 1.25 : 1.12) : 0.92;
  } else {
    u.pitch = 1;
  }

  u.onend = () => {
    if(!speaking || paused) return;
    const prev = units[current];
    current++;
    if(current >= units.length){ stopAll(); return; }
    const cur = units[current];
    let wait;
    if(cur.sIdx !== prev.sIdx){          // 換句
      wait = parseInt(pauseLen.value, 10);
      if(sentences[cur.sIdx] && sentences[cur.sIdx].paraGap) wait += 300;
    } else {
      wait = 80;                          // 同句內對話↔旁白之間的小停頓
    }
    gapTimer = setTimeout(speakCurrent, wait);
  };
  u.onerror = () => {};

  speechSynthesis.speak(u);
}

function startFrom(i){
  cancelSpeech();
  current = i;
  speaking = true; paused = false;
  lastHiIdx = -1;
  setButtons();
  if(hqMode.checked) hqPlayFrom(i);
  else speakCurrent();
}

function play(){
  // iPhone 需要在使用者「點擊」當下先解鎖音訊播放
  if(hqMode.checked && !hqUnlocked){
    hqAudio.src = SILENT;
    hqAudio.play().then(() => { hqUnlocked = true; }).catch(() => {});
  }
  if(paused){
    paused = false;
    setButtons();
    if(hqMode.checked){ programmaticPause = false; hqAudio.play().catch(()=>{}); }
    else speechSynthesis.resume();
    return;
  }
  if(!units.length) return;
  startFrom(current >= 0 && current < units.length ? current : 0);
}

function pause(){
  if(!speaking || paused) return;
  paused = true;
  setButtons();
  if(hqMode.checked){ programmaticPause = true; hqAudio.pause(); }
  else speechSynthesis.pause();
}

function stopAll(){
  cancelPrepare = true;      // 若正在準備音檔，中止它
  cancelSpeech();
  speaking = false; paused = false;
  preparing = false;
  current = -1;
  lastHiIdx = -1;
  highlight(-1);
  hidePrep();
  setButtons();
}

function cancelSpeech(){
  if(gapTimer){ clearTimeout(gapTimer); gapTimer = null; }
  speechSynthesis.cancel();
  programmaticPause = true;
  try { hqAudio.pause(); } catch(e){}
}

function setButtons(){
  playBtn.disabled  = preparing || (speaking && !paused);
  pauseBtn.disabled = preparing || !speaking || paused;
  stopBtn.disabled  = preparing ? false : !speaking;
}

// ============================================================
//  4) 中文聲音載入（旁白 + 對話兩個下拉都填）
// ============================================================
function fillVoiceSelect(sel){
  const keep = sel.value;
  sel.innerHTML = '';
  const ordered = voices
    .map((v, idx) => ({ v, idx }))
    .sort((a,b) => {
      const za = /zh|cmn|Chinese|中文|國語|粵/.test(a.v.lang + a.v.name) ? 0 : 1;
      const zb = /zh|cmn|Chinese|中文|國語|粵/.test(b.v.lang + b.v.name) ? 0 : 1;
      return za - zb;
    });
  ordered.forEach(({ v, idx }) => {
    const opt = document.createElement('option');
    opt.value = idx;
    const zh = /zh|cmn|Chinese/.test(v.lang) ? '🀄 ' : '';
    opt.textContent = `${zh}${v.name}（${v.lang}）`;
    sel.appendChild(opt);
  });
  if(keep) sel.value = keep;
}

function loadVoices(){
  voices = speechSynthesis.getVoices();
  fillVoiceSelect(voiceSelect);
  fillVoiceSelect(dialogueVoiceSelect);

  // 若有兩個以上中文聲音，預設讓對話用「不同的」那一個
  if(!dialogueVoiceSelect.dataset.userSet){
    const zh = voices.map((v,i)=>({v,i})).filter(o=>/zh|cmn|Chinese/.test(o.v.lang));
    if(zh.length >= 2 && voiceSelect.value){
      const alt = zh.find(o => String(o.i) !== voiceSelect.value);
      if(alt) dialogueVoiceSelect.value = String(alt.i);
    }
  }

  if(!voices.length){
    hint.textContent = '⚠️ 這個裝置沒有偵測到語音，請確認系統已安裝中文語音。';
  }
}

// ============================================================
//  5) 事件綁定
// ============================================================
cleanBtn.addEventListener('click', () => {
  const raw = inputText.value;
  if(!raw.trim()){ hint.textContent = '請先貼上文章。'; return; }
  sentences = buildSentences(raw);
  if(!sentences.length){ hint.textContent = '沒有可朗讀的內容。'; return; }
  localStorage.setItem('lastText', raw);
  buildUnits();
  renderSentences();
  inputView.classList.add('hidden');
  readView.classList.remove('hidden');
  stopAll();
  hint.textContent = storyMode.checked
    ? '琥珀色＝對話、墨綠色＝旁白。分錯的話可回去調整原文引號。'
    : '斷句若有錯，可回去編輯原文再整理一次。';
});

clearBtn.addEventListener('click', () => {
  inputText.value = '';
  localStorage.removeItem('lastText');
  inputText.focus();
});

backBtn.addEventListener('click', () => {
  stopAll();
  readView.classList.add('hidden');
  inputView.classList.remove('hidden');
});

playBtn.addEventListener('click', play);
pauseBtn.addEventListener('click', pause);
stopBtn.addEventListener('click', stopAll);

rate.addEventListener('input', () => {
  rateVal.textContent = parseFloat(rate.value).toFixed(1) + '×';
  localStorage.setItem('rate', rate.value);
  if(hqMode.checked) hqAudio.playbackRate = parseFloat(rate.value);
});

pauseLen.addEventListener('input', () => {
  const v = parseInt(pauseLen.value,10);
  pauseVal.textContent = v<=100 ? '短' : v<=300 ? '中' : '長';
  localStorage.setItem('pauseLen', pauseLen.value);
});

voiceSelect.addEventListener('change', () => {
  localStorage.setItem('voice', voiceSelect.value);
});

dialogueVoiceSelect.addEventListener('change', () => {
  dialogueVoiceSelect.dataset.userSet = '1';
  localStorage.setItem('dialogueVoice', dialogueVoiceSelect.value);
});

storyMode.addEventListener('change', () => {
  localStorage.setItem('storyMode', storyMode.checked ? '1' : '0');
  dialogueVoiceWrap.classList.toggle('hidden', !storyMode.checked);
  azureDlgWrap.classList.toggle('hidden', !storyMode.checked);
  if(sentences.length){
    stopAll();
    buildUnits();
    renderSentences();
    hint.textContent = storyMode.checked
      ? '已開啟說故事模式：琥珀色＝對話、墨綠色＝旁白。'
      : '已關閉說故事模式，改為平順朗讀。';
  }
});

// 高音質（雲端）開關
function applyHqUI(){
  browserVoices.classList.toggle('hidden', hqMode.checked);
  azureVoices.classList.toggle('hidden', !hqMode.checked);
}
hqMode.addEventListener('change', () => {
  localStorage.setItem('hqMode', hqMode.checked ? '1' : '0');
  applyHqUI();
  stopAll();
  hint.textContent = hqMode.checked
    ? '已開啟高音質：使用雲端 AI 聲音（需要網路）。'
    : '已關閉高音質：使用免費手機語音（可離線）。';
});

azureNarSelect.addEventListener('change', () => localStorage.setItem('azureNar', azureNarSelect.value));
azureDlgSelect.addEventListener('change', () => localStorage.setItem('azureDlg', azureDlgSelect.value));
narStyle.addEventListener('change', () => localStorage.setItem('narStyle', narStyle.value));
dlgStyle.addEventListener('change', () => localStorage.setItem('dlgStyle', dlgStyle.value));

// 填入 AI 聲音與語氣選單
function fillAzureSelects(){
  [azureNarSelect, azureDlgSelect].forEach(sel => {
    sel.innerHTML = '';
    AZURE_VOICES.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.label;
      sel.appendChild(opt);
    });
  });
  [narStyle, dlgStyle].forEach(sel => {
    sel.innerHTML = '';
    AZURE_STYLES.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.label;
      sel.appendChild(opt);
    });
  });
  // 預設：旁白曉臻、對話雲哲、語氣自然
  azureNarSelect.value = 'zh-TW-HsiaoChenNeural';
  azureDlgSelect.value = 'zh-TW-YunJheNeural';
  narStyle.value = 'general';
  dlgStyle.value = 'general';
}

// ============================================================
//  5b) 我的清單（可預先載入）
// ============================================================
function libData(){
  try { return JSON.parse(localStorage.getItem('library') || '[]'); } catch(e){ return []; }
}
function libSave(arr){ localStorage.setItem('library', JSON.stringify(arr)); renderLibrary(); }

function renderLibrary(){
  const arr = libData();
  libraryList.innerHTML = '';
  if(!arr.length){
    libraryList.innerHTML = '<p class="mini-note">清單是空的。貼上文章、輸入標題後按「存到清單」。</p>';
    return;
  }
  arr.forEach(item => {
    const row = document.createElement('div');
    row.className = 'lib-item';
    const t = document.createElement('span');
    t.className = 'lib-title'; t.textContent = item.title;
    t.addEventListener('click', () => loadFromLibrary(item.id));
    const load = document.createElement('button');
    load.className = 'btn btn-ghost small'; load.textContent = '載入';
    load.addEventListener('click', () => loadFromLibrary(item.id));
    const del = document.createElement('button');
    del.className = 'btn btn-ghost small'; del.textContent = '刪除';
    del.addEventListener('click', () => {
      if(confirm('刪除「' + item.title + '」？')) libSave(libData().filter(x => x.id !== item.id));
    });
    row.appendChild(t); row.appendChild(load); row.appendChild(del);
    libraryList.appendChild(row);
  });
}

function loadFromLibrary(id){
  const item = libData().find(x => x.id === id);
  if(!item) return;
  inputText.value = item.text;
  cleanBtn.click();
}

saveBtn.addEventListener('click', () => {
  const text = inputText.value.trim();
  if(!text){ hint.textContent = '請先貼上文章再存。'; return; }
  const title = saveTitle.value.trim() || ('未命名 ' + new Date().toLocaleDateString());
  const arr = libData();
  arr.push({ id: Date.now(), title, text });
  libSave(arr);
  saveTitle.value = '';
  hint.textContent = '已存到清單：' + title;
});

// 預先載入清單裡所有文章的 AI 語音（之後可離線秒播）
preloadBtn.addEventListener('click', async () => {
  if(!hqMode.checked){ hint.textContent = '請先開啟「高音質」再預先載入。'; return; }
  const arr = libData();
  if(!arr.length){ hint.textContent = '清單是空的，沒有可載入的。'; return; }
  preloadBtn.disabled = true;
  const story = storyMode.checked;
  let loaded = 0, skipped = 0;
  for(let k=0;k<arr.length;k++){
    if(quotaExhausted()){ notifyQuota(); break; }
    const sents = buildSentences(arr[k].text);
    const us = buildUnitsFrom(sents, story);
    if(!us.length) continue;
    const key = trackKeyFor(us);
    if(await cachedTrack(key)){ skipped++; continue; }   // 已載入過
    cancelPrepare = false;
    const track = await generateTrack(us, sents, key, (i,total) => {
      prepEl.classList.remove('hidden');
      prepEl.textContent = '預先載入「' + arr[k].title + '」… ' + (i+1) + '/' + total +
        '（第 ' + (k+1) + '/' + arr.length + ' 篇）';
    });
    if(track) loaded++;
  }
  hidePrep();
  preloadBtn.disabled = false;
  hint.textContent = '預先載入完成：新增 ' + loaded + ' 篇、已存在 ' + skipped + ' 篇。這些之後可離線秒播。';
});

// ============================================================
//  6) 初始化
// ============================================================
function init(){
  const savedText = localStorage.getItem('lastText');
  if(savedText) inputText.value = savedText;
  const savedRate = localStorage.getItem('rate');
  if(savedRate){ rate.value = savedRate; rateVal.textContent = parseFloat(savedRate).toFixed(1)+'×'; }
  const savedPause = localStorage.getItem('pauseLen');
  if(savedPause){ pauseLen.value = savedPause; }
  pauseLen.dispatchEvent(new Event('input'));

  const savedStory = localStorage.getItem('storyMode');
  storyMode.checked = savedStory !== '0';   // 預設開啟
  dialogueVoiceWrap.classList.toggle('hidden', !storyMode.checked);
  azureDlgWrap.classList.toggle('hidden', !storyMode.checked);

  // 高音質模式與 AI 聲音
  hqMode.checked = localStorage.getItem('hqMode') === '1';
  applyHqUI();
  fillAzureSelects();
  const restore = (sel, k) => {
    const s = localStorage.getItem(k);
    if(s && sel.querySelector(`option[value="${s}"]`)) sel.value = s;
  };
  restore(azureNarSelect, 'azureNar');
  restore(azureDlgSelect, 'azureDlg');
  restore(narStyle, 'narStyle');
  restore(dlgStyle, 'dlgStyle');

  renderLibrary();
  renderQuota();

  loadVoices();
  if(speechSynthesis.onvoiceschanged !== undefined){
    speechSynthesis.onvoiceschanged = () => {
      loadVoices();
      const sv = localStorage.getItem('voice');
      if(sv && voiceSelect.querySelector(`option[value="${sv}"]`)) voiceSelect.value = sv;
      const dv = localStorage.getItem('dialogueVoice');
      if(dv && dialogueVoiceSelect.querySelector(`option[value="${dv}"]`)){
        dialogueVoiceSelect.value = dv;
        dialogueVoiceSelect.dataset.userSet = '1';
      }
    };
  }

  if(!('speechSynthesis' in window)){
    hint.textContent = '⚠️ 你的瀏覽器不支援語音朗讀，請改用 Safari 或 Chrome。';
    cleanBtn.disabled = true;
  }
}
init();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}
