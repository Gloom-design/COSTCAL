export default async function handler(req, res) {
  // 🛡️ 1. 設定 CORS 白名單網域
  const allowedOrigins = [
    'https://gloom-design.github.io',   // 你的 GitHub Pages 主要網域 (Origin 不包含路徑)
    'https://costcal-peach.vercel.app', // Vercel 專案網域
    'http://localhost:3000',            // 本地開發測試
    'http://127.0.0.1:5500'             // 本地 VS Code Live Server 測試
  ];

  const origin = req.headers.origin;

  // 🛡️ 2. 處理瀏覽器的預檢請求 (Preflight OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // 🛡️ 3. 攔截非法來源 (阻擋 Python 腳本或陌生網站盜用 API)
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden: 拒絕外部網域存取 API', apiVersion: 'v7.4.2' });
  }

  // 🛡️ 4. 來源合法，允許通過
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // ==========================================
  // 以下為原有的股票查詢業務邏輯
  // ==========================================
  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v7.4.2' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();
  let resolvedName = queryTerm;

  try {
    if (/^\d{4}$/.test(queryTerm)) {
      finalSymbol = queryTerm + '.TW';
    } else if (/[\u4e00-\u9fa5]/.test(queryTerm)) {
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
          }
        }
      } catch (e) {}
    } else {
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

    // 💡 加入 includePrePost=true 參數以支援盤前與盤後數據
    let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
    let response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      return res.status(400).json({ error: `找不到代號 ${finalSymbol} 的市場資料`, apiVersion: 'v7.4.2' });
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      return res.status(400).json({ error: '查無市場資料', apiVersion: 'v7.4.2' });
    }

    const meta = result.meta;
    
    // 💡 優先順序：盤前價 (preMarketPrice) > 盤後價 (postMarketPrice) > 正規盤價 > 收盤/前收價
    const currentPrice = meta.preMarketPrice || meta.postMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;

    return res.status(200).json({
      symbol: meta.symbol || finalSymbol,
      name: resolvedName,
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice),
      apiVersion: 'v7.4.2'
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v7.4.2' });
  }
}
