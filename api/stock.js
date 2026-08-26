export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();

  // 1. 如果包含中文或非標準美股代號格式，透過公開的全球財經搜尋 API 進行動態名稱檢索
  if (/[\u4e00-\u9fa5]/.test(queryTerm) || !/^[A-Z0-9.]+$/i.test(queryTerm)) {
    try {
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=6&newsCount=0`;
      const searchRes = await fetch(searchUrl, { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
        } 
      });
      const searchData = await searchRes.json();
      const quotes = searchData.quotes || [];

      // 優先過濾出美股或一般股票代號（排除有 .TW / .TWO 等非美股項目，除非是美股查詢）
      const usMatch = quotes.find(q => q.symbol && !q.symbol.endsWith('.TW') && !q.symbol.endsWith('.TWO') && !q.symbol.includes('.'));
      const anyMatch = quotes[0];

      if (usMatch) {
        finalSymbol = usMatch.symbol;
      } else if (anyMatch && anyMatch.symbol) {
        finalSymbol = anyMatch.symbol;
      }
    } catch (e) {
      // 網路檢索失敗則直接帶入原名稱
    }
  }

  // 2. 判斷是否為台股代號（4碼純數字）
  if (/^\d{4}$/.test(finalSymbol)) {
    finalSymbol += '.TW';
  }

  try {
    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
    let response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    // 若台股 .TW 失敗自動嘗試 .TWO
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      throw new Error(`找不到該代號或行情取得失敗`);
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      throw new Error('查無市場資料');
    }

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;

    return res.status(200).json({
      symbol: meta.symbol || finalSymbol,
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice)
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
