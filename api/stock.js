export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v4.8.1' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();
  let resolvedName = queryTerm;

  try {
    // 1. 檢查是否為台股 (4碼純數字或名稱包含中文)
    if (/^\d{4}$/.test(queryTerm)) {
      finalSymbol = queryTerm + '.TW';
    } else if (/[\u4e00-\u9fa5]/.test(queryTerm)) {
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

      // 如果不是台股但包含中文（代表是美股輸入了中文名稱，如「微軟」），透過 Yahoo 官方 Search API 轉成英文代號
      if (!foundTw) {
        try {
          const searchRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1&newsCount=0`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData && searchData.quotes && searchData.quotes.length > 0) {
              finalSymbol = searchData.quotes[0].symbol;
              resolvedName = searchData.quotes[0].shortname || searchData.quotes[0].longname || queryTerm;
            }
          }
        } catch (e) {}
      }
    }

    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
    let response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    // 台股上市失敗改試上櫃 .TWO
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      return res.status(400).json({ error: `找不到代號 ${finalSymbol} 的市場資料`, apiVersion: 'v4.8.1' });
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      return res.status(400).json({ error: '查無市場資料', apiVersion: 'v4.8.1' });
    }

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;

    return res.status(200).json({
      symbol: meta.symbol || finalSymbol,
      name: resolvedName,
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice),
      apiVersion: 'v4.8.1'
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v4.8.1' });
  }
}
