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
function buildUnits(){
  units = [];
  sentFirstUnit = [];
  const story = storyMode.checked;
  sentences.forEach((s, sIdx) => {
    sentFirstUnit[sIdx] = units.length;
    const segs = story ? s.segments : [{ text:s.fullText, type:'narration' }];
    segs.forEach(seg => {
      if(seg.text.trim()) units.push({ text:seg.text, type:seg.type, sIdx });
    });
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
//  3a) 雲端 AI 語音（高音質）
// ============================================================
function azureVoiceFor(unit){
  return (storyMode.checked && unit.type === 'dialogue')
    ? azureDlgSelect.value : azureNarSelect.value;
}

function azureStyleFor(unit){
  return (storyMode.checked && unit.type === 'dialogue')
    ? dlgStyle.value : narStyle.value;
}

function buildSSML(text, voiceName, style){
  const esc = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const locale = voiceName.split('-').slice(0, 2).join('-');   // zh-TW / zh-CN
  // 情緒只對大陸腔（zh-CN）聲音套用
  let inner = esc;
  if(style && style !== 'general' && locale === 'zh-CN'){
    inner = "<mstts:express-as style='" + style + "'>" + esc + "</mstts:express-as>";
  }
  return "<speak version='1.0' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='" +
    locale + "'><voice name='" + voiceName + "'>" + inner + "</voice></speak>";
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
      // 4xx（非 429）多半是內容問題，重試沒用，直接回傳讓上層處理
      if(r.status !== 429 && r.status < 500) return r;
      lastErr = new Error('tts ' + r.status);
    } catch(e){
      lastErr = e;   // 網路錯誤
    }
    await sleep(500 * (i + 1));   // 遞增等待再重試
  }
  throw lastErr || new Error('tts failed');
}

// 取得某一段的音檔網址：先看記憶體、再看手機本機快取、最後才跟雲端要
async function getAudioURL(unit){
  const voiceName = azureVoiceFor(unit);
  const style = azureStyleFor(unit);
  const key = voiceName + '|' + style + '|' + unit.text;
  if(memCache.has(key)) return memCache.get(key);

  const cacheKey = 'https://tts.cache/' + encodeURIComponent(key);
  let cache = null;
  try { cache = await caches.open('tts-audio'); } catch(e){ cache = null; }

  let resp = cache ? await cache.match(cacheKey) : null;
  if(!resp){
    let r = await fetchTTS(buildSSML(unit.text, voiceName, style));
    // 若帶情緒失敗（某些聲音不支援該情緒），自動退回無情緒再試一次
    if(!r.ok && style && style !== 'general'){
      r = await fetchTTS(buildSSML(unit.text, voiceName, 'general'));
    }
    if(!r.ok) throw new Error('tts ' + r.status);
    if(cache){ try { await cache.put(cacheKey, r.clone()); } catch(e){} }
    resp = r;
  }
  const url = URL.createObjectURL(await resp.blob());
  memCache.set(key, url);
  return url;
}

function prefetch(i){
  if(i < units.length) getAudioURL(units[i]).catch(()=>{});
}

async function speakCurrentHQ(){
  if(current < 0 || current >= units.length){ stopAll(); return; }
  const unit = units[current];
  highlight(unit.sIdx);
  let url;
  try {
    url = await getAudioURL(unit);
  } catch(e){
    // 多次重試仍失敗：停在這一句、保留位置，按 ▶ 可從這裡繼續
    haltKeepPos('⚠️ 網路不穩，唸到這句先停了。網路恢復後按 ▶ 會從這句接著念。');
    return;
  }
  if(!speaking || paused) return;   // 抓取途中被停掉
  prefetch(current + 1);            // 先預抓下一段，減少空隙
  hqAudio.src = url;
  hqAudio.playbackRate = parseFloat(rate.value);
  hqAudio.play().catch(() => {      // 播放被打斷時再試一次
    setTimeout(() => { if(speaking && !paused) hqAudio.play().catch(()=>{}); }, 250);
  });
}

// 「軟停止」：停下但保留目前句子位置，方便按播放接續
function haltKeepPos(msg){
  if(gapTimer){ clearTimeout(gapTimer); gapTimer = null; }
  speechSynthesis.cancel();
  try { hqAudio.pause(); } catch(e){}
  speaking = false; paused = false;   // 注意：不清掉 current
  setButtons();
  if(msg) hint.textContent = msg;
}

hqAudio.onended = () => {
  if(!speaking || paused) return;
  const prev = units[current];
  current++;
  if(current >= units.length){ stopAll(); return; }
  const cur = units[current];
  let wait;
  if(cur.sIdx !== prev.sIdx){
    wait = parseInt(pauseLen.value, 10);
    if(sentences[cur.sIdx] && sentences[cur.sIdx].paraGap) wait += 300;
  } else {
    wait = 80;
  }
  gapTimer = setTimeout(speakCurrentHQ, wait);
};

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
  setButtons();
  if(hqMode.checked) speakCurrentHQ();
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
    if(hqMode.checked) hqAudio.play().catch(()=>{});
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
  if(hqMode.checked) hqAudio.pause();
  else speechSynthesis.pause();
}

function stopAll(){
  cancelSpeech();
  speaking = false; paused = false;
  current = -1;
  highlight(-1);
  setButtons();
}

function cancelSpeech(){
  if(gapTimer){ clearTimeout(gapTimer); gapTimer = null; }
  speechSynthesis.cancel();
  try { hqAudio.pause(); } catch(e){}
}

function setButtons(){
  playBtn.disabled  = speaking && !paused;
  pauseBtn.disabled = !speaking || paused;
  stopBtn.disabled  = !speaking;
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
