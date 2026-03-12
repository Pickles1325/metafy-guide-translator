const STORAGE_KEY = 'metafy_translator_apikey';

const input = document.getElementById('api-key-input');
const saveBtn = document.getElementById('save-btn');
const toggleVis = document.getElementById('toggle-vis');
const statusBadge = document.getElementById('status-badge');
const toast = document.getElementById('toast');

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.style.background = isError ? '#201010' : '#0d2010';
  toast.style.color = isError ? '#e86e6e' : '#6ecb6e';
  toast.style.borderColor = isError ? '#e86e6e44' : '#6ecb6e44';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function updateStatus(hasKey) {
  if (hasKey) {
    statusBadge.textContent = '設定済み';
    statusBadge.className = 'status-badge active';
  } else {
    statusBadge.textContent = '未設定';
    statusBadge.className = 'status-badge inactive';
  }
}

// Load existing key
chrome.storage.local.get([STORAGE_KEY], (result) => {
  const key = result[STORAGE_KEY] || '';
  if (key) {
    input.value = key;
    updateStatus(true);
  }
});

// Toggle visibility
let isVisible = false;
toggleVis.addEventListener('click', () => {
  isVisible = !isVisible;
  input.type = isVisible ? 'text' : 'password';
  toggleVis.textContent = isVisible ? '🙈' : '👁';
});

// Save
saveBtn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) {
    showToast('APIキーを入力してください', true);
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    showToast('有効なAnthropicのAPIキーを入力してください', true);
    return;
  }
  chrome.storage.local.set({ [STORAGE_KEY]: key }, () => {
    updateStatus(true);
    showToast('✓ APIキーを保存しました');
  });
});

// Enter key
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});

// ===== キャッシュ管理 =====
const clearCacheBtn = document.getElementById('clear-cache-btn');
const cacheInfo = document.getElementById('cache-info');

function updateCacheInfo() {
  chrome.storage.local.get(null, (items) => {
    const cacheKeys = Object.keys(items).filter(k => k.startsWith('mtfy_cache_'));
    if (cacheKeys.length === 0) {
      cacheInfo.textContent = 'キャッシュなし';
      clearCacheBtn.disabled = true;
      clearCacheBtn.style.opacity = '0.4';
    } else {
      cacheInfo.textContent = cacheKeys.length + 'ページ分のキャッシュあり';
      clearCacheBtn.disabled = false;
      clearCacheBtn.style.opacity = '1';
    }
  });
}

clearCacheBtn.addEventListener('click', () => {
  chrome.storage.local.get(null, (items) => {
    const cacheKeys = Object.keys(items).filter(k => k.startsWith('mtfy_cache_'));
    chrome.storage.local.remove(cacheKeys, () => {
      updateCacheInfo();
      showToast('✓ キャッシュを削除しました');
    });
  });
});

updateCacheInfo();
