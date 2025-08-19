// API 実装の切り替えローダー
(async function chooseApi() {
  // 設定の読み込み完了を待機
  if (window.APP_CONFIG_READY && typeof window.APP_CONFIG_READY.then === 'function') {
    try { await window.APP_CONFIG_READY; } catch (e) { console.error(e); }
  }
  const head = document.head;
  const script = document.createElement('script');
  script.async = false;
  script.defer = false;
  // 常に external API を使用
  script.src = 'js/api.external.js';
  window.API_READY = new Promise((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('API script load failed'));
  });
  head.appendChild(script);
})();
