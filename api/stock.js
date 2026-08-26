export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol, search } = req.query;
  let queryTerm = search || symbol;

  if (!queryTerm) {
    return res.status(400).json({ error: 'Missing symbol or search term' });
  }

  // 1. 後端強固對應表（確保常用或容易查不到的股票秒速對應）
  const backendDictionary = {
    "亞力": "1514.TW",
    "力成": "6239.TWO",
    "德律": "3030.TW",
    "台積電": "2330.TW",
    "智邦": "2345.TW",
    "台達電": "2308.TW",
    "穩懋": "3105.TWO",
    "貿聯-KY": "3665.TW",
    "貿聯": "3665.TW",
    "鴻海": "2317.TW",
    "聯發科": "2454.TW",
    "智原": "3035.TW",
    "廣達": "2382.TW",
    "緯創": "3231.TW"
  };

  let cleanQuery = queryTerm.trim();
  if (backendDictionary[cleanQuery]) {
    cleanQuery = backendDictionary[cleanQuery];
  } else if (search) {
    // 如果是純中文名稱但不在字典裡，嘗試透過 Yahoo 搜尋
    try {
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanQuery)}&quotesCount=1`;
      const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const searchData = await searchRes.json();
      const quote = searchData.quotes?.[0];
      if (quote && quote.symbol) {
        cleanQuery = quote.symbol;
      }
    } catch (e) {
      // 搜尋失敗則維持原樣
    }
  }

  // 格式化台股代號後綴
  let finalSymbol = cleanQuery.toUpperCase();
  if (/^\d{4}$/.test(finalSymbol)) {
    const knownTwo = ["6223", "3105", "3293", "5347", "6515", "8299", "3548", "3030"];
    finalSymbol += knownTwo.includes(finalSymbol) ? '.TWO' : '.TW';
  }

  // 如果前端是呼叫 search 模式，回傳解析後的 symbol
  if (search && !symbol) {
    return res.status(200).json({ symbol: finalSymbol });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
    let response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    // 如果 .TW 失敗，自動嘗試 .TWO
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      const fallbackUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
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
