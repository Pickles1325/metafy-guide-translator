// Background service worker
// 現在は特別な処理は不要ですが、将来的な拡張用に保持

chrome.runtime.onInstalled.addListener(() => {
  console.log('Metafy Translator installed');
});
