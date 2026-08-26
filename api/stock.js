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

  // 如果包含中文或不是純代號格式，透過 Yahoo 搜尋 API 自動把中文轉成正確代號！
  if (/[\u4e00-\u9fa5]/.test(queryTerm) || !/^[A-Z0-9.]+$/i.test(queryTerm)) {
    try {
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1`;
      const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const searchData = await searchRes.json();
      const quote = searchData.quotes?.[0];
      if (quote && quote.symbol) {
        queryTerm = quote.symbol; // 例如自動找到 "2383.TW"
      }
    } catch (e) {
      // 搜尋失敗則繼續往下嘗試
    }
  }

  let finalSymbol = queryTerm.toUpperCase();
  
  // 自動補上台股後綴 (.TW 或 .TWO)
  if (/^\d{4}$/.test(finalSymbol)) {
    const knownTwo = ["6223", "3105", "3293", "5347", "6515", "8299", "3548", "3030"];
    finalSymbol += knownTwo.includes(finalSymbol) ? '.TWO' : '.TW';
  } else if (/^\d{4}\.TW$/.test(finalSymbol)) {
    // 預防萬一
  }

  try {
    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
    let response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    // 如果 .TW 失敗，自動嘗試 .TWO
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      throw new Error(`Yahoo API status ${response.status}`);
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      throw new Error('Invalid symbol data from Yahoo');
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
