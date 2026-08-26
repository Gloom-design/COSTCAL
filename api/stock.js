export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: '缺少股票代號' });
  }

  try {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}?interval=1d`;
    
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    if (!response.ok) {
      throw new Error('無法從財經源取得資料');
    }

    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;

    if (!meta) {
      throw new Error('查無此代號');
    }

    return res.status(200).json({
      symbol: symbol.toUpperCase(),
      currentPrice: meta.regularMarketPrice,
      prevClose: meta.chartPreviousClose || meta.previousClose
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
