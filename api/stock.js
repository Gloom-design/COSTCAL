export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v4.9.5' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();
  let resolvedName = queryTerm;

  // 1. 若包含中文，先檢查是否為台股
  if (/[\u4e00-\u9fa5]/.test(queryTerm)) {
    let foundTw = false;
    try {
      const listRes = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { 
        headers: { 'User-Agent': 'Mozilla/5.0' } 
      });
      if (listRes.ok) {
        const stockList = await listRes.json();
        const found = stockList.find(item => item.Name && item.Name.includes(queryTerm));
        if (found && found.Code) {
          finalSymbol = found.Code + '.TW';
          resolvedName = found.Name.trim();
          foundTw = true;
        }
      }
    } catch (e) {}

    // 2. 若不是台股，代表是中文美股名稱（例如「昂跑」、「美光」），透過 Yahoo Finance 官方公開搜尋 API 動態尋找標準代號
    if (!foundTw) {
      try {
        const searchRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1&newsCount=0`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.quotes && searchData.quotes.length > 0) {
            finalSymbol = searchData.quotes[0].symbol;
            resolvedName = queryTerm; // 保留使用者輸入的中文名稱作為顯示名稱
          }
        }
      } catch (e) {}
    }
  } else {
    // 若為純英文，也透過搜尋確保代號最精準
    try {
      const searchRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1&newsCount=0`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.quotes && searchData.quotes.length > 0) {
          finalSymbol = searchData.quotes[0].symbol;
        }
      }
    } catch (e) {}
  }

  // 若為台股 4 碼純數字自動補 .TW
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
    
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      throw new Error(`找不到代號 ${finalSymbol} 的市場資料`);
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
      name: resolvedName,
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice),
      apiVersion: 'v4.9.5'
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v4.9.5' });
  }
}
