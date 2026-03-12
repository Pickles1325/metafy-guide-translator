// Metafy Guide Translator - 固定オーバーレイ方式

const STORAGE_KEY = 'metafy_translator_apikey';
const CACHE_PREFIX = 'mtfy_cache_';
const TEXT_ELEMENT_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption';

let translationActive = false;
let appliedPairs = [];
let overlayContainer = null;
let reapplyObserver = null;

function getCacheKey() { return CACHE_PREFIX + location.pathname; }
function saveCache(pairs) {
  chrome.storage.local.set({ [getCacheKey()]: { pairs, savedAt: Date.now() } });
}
function loadCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([getCacheKey()], r => resolve(r[getCacheKey()] || null));
  });
}

// ===== UI =====
function createFloatingButton() {
  if (document.getElementById('mtfy-translate-btn')) return;
  const btn = document.createElement('div');
  btn.id = 'mtfy-translate-btn';
  btn.innerHTML = `<span class="mtfy-flag">🇯🇵</span><span class="mtfy-label">翻訳</span>`;
  btn.addEventListener('click', onToggleTranslation);
  document.body.appendChild(btn);
}
function createStatusBanner() {
  if (document.getElementById('mtfy-status-banner')) return;
  const b = document.createElement('div');
  b.id = 'mtfy-status-banner';
  b.style.display = 'none';
  document.body.appendChild(b);
}
function showStatus(msg, type) {
  const b = document.getElementById('mtfy-status-banner');
  if (!b) return;
  b.className = 'mtfy-status-' + (type || 'loading');
  b.innerHTML = msg;
  b.style.display = 'block';
}
function hideStatus() {
  const b = document.getElementById('mtfy-status-banner');
  if (b) b.style.display = 'none';
}
function updateButton(state) {
  const btn = document.getElementById('mtfy-translate-btn');
  if (!btn) return;
  btn.classList.remove('mtfy-active','mtfy-loading','mtfy-cached');
  const flag = btn.querySelector('.mtfy-flag');
  const label = btn.querySelector('.mtfy-label');
  if      (state === 'translated')        { btn.classList.add('mtfy-active');               flag.textContent='🇯🇵'; label.textContent='元に戻す'; }
  else if (state === 'translated-cached') { btn.classList.add('mtfy-active','mtfy-cached'); flag.textContent='💾'; label.textContent='元に戻す'; }
  else if (state === 'loading')           { btn.classList.add('mtfy-loading');               flag.textContent='🇯🇵'; label.textContent='翻訳中...'; }
  else if (state === 'cache-ready')       {                                                  flag.textContent='💾'; label.textContent='翻訳 (保存済)'; }
  else                                    {                                                  flag.textContent='🇯🇵'; label.textContent='翻訳'; }
}

async function getApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], r => resolve(r[STORAGE_KEY] || ''));
  });
}

// ===== テキスト収集 =====
function collectTextElements() {
  const result = [];
  document.querySelectorAll(TEXT_ELEMENT_SELECTORS).forEach(el => {
    if (el.closest('[id^="mtfy-"]')) return;
    if (el.closest('nav,header,footer,button,[role="navigation"]')) return;
    if (el.querySelector(TEXT_ELEMENT_SELECTORS)) return;
    if (el.hasAttribute('data-mtfy-done')) return;
    const text = el.textContent.trim();
    if (text.length < 4) return;
    if (/^[\d\s\.\-\+\*\/\%\:\,\!\?\(\)]+$/.test(text)) return;
    const jpRatio = (text.match(/[\u3040-\u30ff\u4e00-\u9fff]/g)||[]).length / text.length;
    if (jpRatio > 0.3) return;
    result.push(el);
  });
  console.log('[Metafy Translator] 収集:', result.length, '件');
  return result;
}

// ===== オーバーレイコンテナ =====
function getOverlayContainer() {
  if (overlayContainer && document.body.contains(overlayContainer)) return overlayContainer;
  overlayContainer = document.createElement('div');
  overlayContainer.id = 'mtfy-overlay-container';
  overlayContainer.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:999998;pointer-events:none;';
  document.body.appendChild(overlayContainer);
  return overlayContainer;
}

// ===== 各要素に翻訳オーバーレイを貼る =====
function createOverlayForElement(el, translatedText) {
  const rect = el.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // 既存オーバーレイがあれば更新
  const existingId = el.getAttribute('data-mtfy-overlay-id');
  if (existingId) {
    const existing = document.getElementById(existingId);
    if (existing) {
      existing.textContent = translatedText;
      // 位置を再計算
      existing.style.top = (rect.top + scrollY) + 'px';
      existing.style.left = (rect.left + scrollX) + 'px';
      existing.style.width = rect.width + 'px';
      return;
    }
  }

  const id = 'mtfy-ov-' + Math.random().toString(36).slice(2);
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'mtfy-overlay-item';

  // 元要素のスタイルを取得して適用
  const cs = window.getComputedStyle(el);
  overlay.style.cssText = `
    position: absolute;
    top: ${rect.top + scrollY}px;
    left: ${rect.left + scrollX}px;
    width: ${rect.width}px;
    min-height: ${rect.height}px;
    font-size: ${cs.fontSize};
    font-family: ${cs.fontFamily};
    font-weight: ${cs.fontWeight};
    line-height: ${cs.lineHeight};
    color: ${cs.color};
    background: ${cs.backgroundColor === 'rgba(0, 0, 0, 0)' ? 'transparent' : cs.backgroundColor};
    padding: ${cs.padding};
    margin: 0;
    box-sizing: border-box;
    z-index: 999998;
    pointer-events: none;
    white-space: pre-wrap;
    word-wrap: break-word;
  `;
  overlay.textContent = translatedText;

  // コンテナではなくbodyに直接追加（absoluteなのでbody基準）
  document.body.appendChild(overlay);

  // 元要素を透明に（テキストだけ）
  el.style.setProperty('color', 'transparent', 'important');
  el.setAttribute('data-mtfy-done', 'true');
  el.setAttribute('data-mtfy-overlay-id', id);
}

// ===== スクロール時に位置を更新 =====
function updateOverlayPositions() {
  document.querySelectorAll('[data-mtfy-overlay-id]').forEach(el => {
    const id = el.getAttribute('data-mtfy-overlay-id');
    const overlay = document.getElementById(id);
    if (!overlay) return;
    const rect = el.getBoundingClientRect();
    overlay.style.top = (rect.top + window.scrollY) + 'px';
    overlay.style.left = (rect.left + window.scrollX) + 'px';
    overlay.style.width = rect.width + 'px';
  });
}

let scrollRaf = null;
function onScroll() {
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(updateOverlayPositions);
}

// ===== 翻訳解除 =====
function revertTranslation() {
  // オーバーレイ削除
  document.querySelectorAll('.mtfy-overlay-item').forEach(o => o.remove());
  // 元のテキスト色を戻す
  document.querySelectorAll('[data-mtfy-done]').forEach(el => {
    el.style.removeProperty('color');
    el.removeAttribute('data-mtfy-done');
    el.removeAttribute('data-mtfy-overlay-id');
  });
  window.removeEventListener('scroll', onScroll, true);
  if (reapplyObserver) { reapplyObserver.disconnect(); reapplyObserver = null; }
  appliedPairs = [];
  translationActive = false;
  loadCache().then(c => updateButton(c ? 'cache-ready' : 'idle'));
  showStatus('元の英語に戻しました', 'success');
  setTimeout(hideStatus, 2000);
}

// ===== 翻訳API =====
async function translateBatch(texts, key) {
  const prompt = `以下の英語テキストをそれぞれ日本語に翻訳してください。
ゲーム用語・カード名・技名・キャラクター名は英語のままカタカナ表記にしてください。
必ず以下のJSON形式のみで返答してください（前置き・説明不要）:
{"translations": ["翻訳1", "翻訳2", ...]}

翻訳するテキスト:
${texts.map((t, i) => `[${i}] ${t}`).join('\n')}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.error?.message || 'API Error ' + res.status);
  }
  const data = await res.json();
  const raw = data.content.map(b => b.text||'').join('');
  return JSON.parse(raw.replace(/```json|```/g,'').trim()).translations;
}

// ===== 適用共通処理 =====
function applyAll(pairs) {
  appliedPairs = pairs;
  pairs.forEach(({ el, translated }) => createOverlayForElement(el, translated));
  // スクロール追従
  window.addEventListener('scroll', onScroll, true);
  // Reactの再レンダリング対策
  if (reapplyObserver) reapplyObserver.disconnect();
  reapplyObserver = new MutationObserver(() => {
    if (!translationActive) return;
    pairs.forEach(({ el, translated }) => {
      if (!el.hasAttribute('data-mtfy-done')) {
        createOverlayForElement(el, translated);
      }
    });
  });
  reapplyObserver.observe(document.body, { childList: true, subtree: true });
}

// ===== キャッシュから適用 =====
function applyFromCache(cache) {
  const elements = collectTextElements();
  const cacheMap = new Map(cache.pairs.map(p => [p.original, p.translated]));
  const pairs = [];
  elements.forEach(el => {
    const t = cacheMap.get(el.textContent.trim());
    if (t) pairs.push({ el, translated: t });
  });
  applyAll(pairs);
  translationActive = true;
  const d = new Date(cache.savedAt).toLocaleDateString('ja-JP');
  updateButton('translated-cached');
  showStatus('💾 キャッシュから復元（' + d + '保存・' + pairs.length + '件）', 'cached');
  setTimeout(hideStatus, 3500);
}

// ===== 新規翻訳 =====
const BATCH_SIZE = 20;

async function runTranslation(key) {
  updateButton('loading');
  showStatus('テキストを収集中...', 'loading');
  const elements = collectTextElements();
  if (elements.length === 0) {
    showStatus('本文が見つかりませんでした。数秒待って再試行してください。', 'error');
    setTimeout(hideStatus, 5000); updateButton('idle'); return;
  }
  showStatus(elements.length + '件を発見。翻訳開始...', 'loading');
  const texts = elements.map(el => el.textContent.trim());
  let translated = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      showStatus('翻訳中... (' + Math.min(i+BATCH_SIZE, texts.length) + '/' + texts.length + ')', 'loading');
      translated = translated.concat(await translateBatch(texts.slice(i, i+BATCH_SIZE), key));
    }
  } catch(err) {
    showStatus('エラー: ' + err.message, 'error');
    setTimeout(hideStatus, 4000); updateButton('idle'); return;
  }

  const cachePairs = [];
  const applyPairs = [];
  elements.forEach((el, i) => {
    if (translated[i]) {
      cachePairs.push({ original: texts[i], translated: translated[i] });
      applyPairs.push({ el, translated: translated[i] });
    }
  });
  saveCache(cachePairs);
  applyAll(applyPairs);
  translationActive = true;
  updateButton('translated');
  showStatus('✓ ' + translated.length + '件を翻訳して保存しました', 'success');
  setTimeout(hideStatus, 3000);
}

// ===== トグル =====
async function onToggleTranslation() {
  if (translationActive) { revertTranslation(); return; }
  const cache = await loadCache();
  if (cache) { applyFromCache(cache); return; }
  const key = await getApiKey();
  if (!key) {
    showStatus('APIキーを設定してください（拡張機能アイコンをクリック）', 'error');
    setTimeout(hideStatus, 4000); return;
  }
  await runTranslation(key);
}

// ===== 初期化 =====
function waitForContent(cb) {
  const check = () => [...document.querySelectorAll('p')].filter(p =>
    p.textContent.trim().length > 30 && !p.closest('[id^="mtfy-"]')
  ).length >= 2;
  if (check()) { cb(); return; }
  let elapsed = 0;
  const timer = setInterval(() => {
    elapsed += 300;
    if (check() || elapsed >= 8000) { clearInterval(timer); cb(); }
  }, 300);
}

async function init() {
  createFloatingButton();
  createStatusBanner();
  waitForContent(async () => {
    const cache = await loadCache();
    if (cache) updateButton('cache-ready');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}