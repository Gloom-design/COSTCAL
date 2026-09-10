// 💡 Webull 24小時盤/即時報價抓取函式
async function fetchWebull24hPrice(symbol) {
  try {
    const searchUrl = `https://quotes-gw.webullbroker.com/api/search/pc/tickers?keyword=${encodeURIComponent(symbol)}&regionId=6&pageIndex=1&pageSize=1`;
    const searchRes = await fetch(searchUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    
    if (!searchData.data || searchData.data.length === 0) return null;
    
    const tickerId = searchData.data[0].tickerId;
    const stockName = searchData.data[0].name;

    const quoteUrl = `https://quotes-gw.webullbroker.com/api/quote/pc/tickerRealTime?tickerId=${tickerId}`;
    const quoteRes = await fetch(quoteUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json'
      }
    });
    
    if (!quoteRes.ok) return null;
    const quoteData = await quoteRes.json();
    
    const latestPrice = quoteData.pPrice || quoteData.close;
    const prevClose = quoteData.preClose || quoteData.close;

    if (!latestPrice) return null;

    return {
      symbol: symbol,
      name: stockName,
      currentPrice: Number(latestPrice),
      prevClose: Number(prevClose)
    };
  } catch (e) {
    console.error("Webull API 錯誤:", e.message);
    return null;
  }
}

export default async function handler(req, res) {
  // 🛡️ 1. 設定 CORS 白名單網域
  const allowedOrigins = [
    'https://gloom-design.github.io',   // GitHub Pages 主要網域
    'https://costcal-peach.vercel.app', // Vercel 專案網域
    'http://localhost:3000',            // 本地開發測試
    'http://127.0.0.1:5500'             // 本地 Live Server 測試
  ];

  const origin = req.headers.origin;

  // 🛡️ 2. 處理預檢請求 (Preflight OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // 🛡️ 3. 攔截非法來源 (阻擋外部非授權存取)
  if (!origin || !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden: 拒絕外部網域存取 API', apiVersion: 'v7.5.0' });
  }

  // 🛡️ 4. 來源合法，設定 CORS 回應頭
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v7.5.0' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();
  let resolvedName = queryTerm;

  try {
    if (/^\d{4}$/.test(queryTerm) || /[\u4e00-\u9fa5]/.test(queryTerm)) {
      // ==========================================
      // 🇹🇼 台股邏輯 (4位數代號 / 中文名稱對照 / 上市櫃自動備用)
      // ==========================================
      if (/^\d{4}$/.test(queryTerm)) {
        finalSymbol = queryTerm + '.TW';
      } else {
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
      }

      let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
      let response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      
      // 上市(.TW)失敗時自動切換至上櫃(.TWO)
      if (!response.ok && finalSymbol.endsWith('.TW')) {
        finalSymbol = finalSymbol.replace('.TW', '.TWO');
        url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
        response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      }

      if (!response.ok) return res.status(400).json({ error: `找不到代號 ${finalSymbol} 的市場資料`, apiVersion: 'v7.5.0' });
      
      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;
      if (!meta) return res.status(400).json({ error: '查無市場資料', apiVersion: 'v7.5.0' });

      const currentPrice = meta.preMarketPrice || meta.postMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose;
      return res.status(200).json({
        symbol: meta.symbol || finalSymbol,
        name: resolvedName,
        currentPrice: Number(currentPrice),
        prevClose: Number(meta.chartPreviousClose || currentPrice),
        apiVersion: 'v7.5.0 (TW)'
      });

    } else {
      // ==========================================
      // 🇺🇸 美股邏輯：優先使用 Webull 24h API，失敗則自動退回 Yahoo
      // ==========================================
      const webullData = await fetchWebull24hPrice(finalSymbol);
      
      if (webullData && webullData.currentPrice) {
        return res.status(200).json({
          ...webullData,
          apiVersion: 'v7.5.0 (Webull 24h)'
        });
      }

      // ⚠️ 備用方案：若 Webull 失敗則自動退回使用 Yahoo API
      const searchRes = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1&newsCount=0`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData && searchData.quotes && searchData.quotes.length > 0) {
          finalSymbol = searchData.quotes[0].symbol;
          resolvedName = searchData.quotes[0].shortname || queryTerm;
        }
      }

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) return res.status(400).json({ error: `找不到資料`, apiVersion: 'v7.5.0' });

      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;
      const currentPrice = meta.preMarketPrice || meta.postMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose;
      
      return res.status(200).json({
        symbol: meta.symbol || finalSymbol,
        name: resolvedName,
        currentPrice: Number(currentPrice),
        prevClose: Number(meta.chartPreviousClose || currentPrice),
        apiVersion: 'v7.5.0 (Yahoo Backup)'
      });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v7.5.0' });
  }
}
