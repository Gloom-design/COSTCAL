export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const cleanSymbol = symbol.toUpperCase().trim();

  // 方案 A：透過 Yahoo Finance V8 API（帶入完整的瀏覽器 Header 避免被阻擋）
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}`;
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const result = data.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
        const prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;

        if (currentPrice) {
          return res.status(200).json({
            symbol: meta.symbol,
            currentPrice: Number(currentPrice),
            prevClose: Number(prevClose)
          });
        }
      }
    }
  } catch (err) {
    // 若 Yahoo 失敗則進入備用方案
  }

  // 方案 B：備用方案（若代號是純數字，改試 FinMind 或 Fugle 公開 API 格式，或回傳友善錯誤）
  return res.status(500).json({ error: `無法取得 ${cleanSymbol} 之即時行情，請稍後再試` });
}
