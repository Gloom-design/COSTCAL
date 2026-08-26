export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

  // 如果前端不小心傳進中文，直接擋下並提示
  if (/[\u4e00-\u9fa5]/.test(symbol)) {
    return res.status(400).json({ error: 'Symbol cannot contain Chinese characters' });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    
    if (!response.ok) throw new Error('Yahoo API error');
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) throw new Error('Invalid symbol data');

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose;

    return res.status(200).json({
      symbol: meta.symbol,
      currentPrice: currentPrice,
      prevClose: prevClose
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
