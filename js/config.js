// アプリケーション設定
// Google Maps APIキーは環境変数から取得します
window.APP_CONFIG = {
  googleMapsApiKey: null,
  apiMode: 'external', // 固定
  externalApiBase: ''
};

// サーバーから設定を取得し、読み込み完了を通知
(function bootstrapConfig() {
  const ready = new Promise(async (resolve) => {
    try {
      // 一旦ローカルのデフォルトAPIに取りに行く
      const res = await fetch(`/api/config`);
      if (res.ok) {
        const cfg = await res.json();
        window.APP_CONFIG.googleMapsApiKey = cfg.googleMapsApiKey || null;
        window.APP_CONFIG.apiMode = cfg.apiMode || 'external';
        window.APP_CONFIG.externalApiBase = cfg.externalApiBase || '';
      } else {
        console.warn('サーバーから設定を取得できませんでした');
      }
    } catch (e) {
      console.warn('設定の取得でエラー:', e);
    }
    resolve();
  });
  window.APP_CONFIG_READY = ready;
})();
