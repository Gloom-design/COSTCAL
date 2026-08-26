export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  const cleanSymbol = symbol.toUpperCase().trim();

  try {
    // 試用 Yahoo Finance v8 chart API
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Yahoo HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      throw new Error('Invalid symbol or no result returned from Yahoo');
    }

    const meta = result.meta;
    
    // 多重欄位備用防護：逐一檢查各種可能帶有價格的欄位，防止欄位為空
    const currentPrice = meta.regularMarketPrice 
      || meta.chartPreviousClose 
      || meta.previousClose 
      || (result.indicators?.quote?.[0]?.close?.[0]);

    const prevClose = meta.chartPreviousClose 
      || meta.previousClose 
      || currentPrice;

    if (!currentPrice) {
      throw new Error(`Could not extract price fields from meta: ${JSON.stringify(meta)}`);
    }

    return res.status(200).json({
      symbol: meta.symbol || cleanSymbol,
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice)
    });

  } catch (error) {
    // 把詳細錯誤訊息回傳，方便你在瀏覽器 DevTools 裡面看清楚是哪個欄位出問題
    return res.status(500).json({ error: error.message });
  }
}
