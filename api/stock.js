// 💡 使用 Promise.race 確保絕對不會卡死或引發環境不相容崩潰 (限制 2.5 秒)
async function safeFetch(url, options = {}) {
  try {
    const response = await Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2500))
    ]);
    return response;
  } catch (e) {
    return null;
  }
}

async function fetchRobinhoodPrice(symbol) {
  const url = `https://api.robinhood.com/quotes/?symbols=${encodeURIComponent(symbol)}`;
  const res = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res || !res.ok) return null;
  
  try {
    const data = await res.json();
    const item = data.results?.[0];
    if (!item) return null;

    const price = item.last_extended_hours_trade_price || item.last_trade_price;
    const prevClose = item.adjusted_previous_close || item.previous_close;
    if (!price) return null;

    return { symbol: item.symbol || symbol, name: symbol, currentPrice: Number(price), prevClose: Number(prevClose || price) };
  } catch (e) { return null; }
}

async function fetchWebull24hPrice(symbol) {
  const searchUrl = `https://quotes-gw.webullbroker.com/api/search/pc/tickers?keyword=${encodeURIComponent(symbol)}&regionId=6&pageIndex=1&pageSize=1`;
  const searchRes = await safeFetch(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
  if (!searchRes || !searchRes.ok) return null;
  
  try {
    const searchData = await searchRes.json();
    if (!searchData.data || searchData.data.length === 0) return null;
    
    const tickerId = searchData.data[0].tickerId;
    const stockName = searchData.data[0].name;

    const quoteUrl = `https://quotes-gw.webullbroker.com/api/quote/pc/tickerRealTime?tickerId=${tickerId}`;
    const quoteRes = await safeFetch(quoteUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    if (!quoteRes || !quoteRes.ok) return null;
    
    const quoteData = await quoteRes.json();
    const latestPrice = quoteData.pPrice || quoteData.close;
    const prevClose = quoteData.preClose || quoteData.close;
    if (!latestPrice) return null;

    return { symbol, name: stockName, currentPrice: Number(latestPrice), prevClose: Number(prevClose) };
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  const allowedOrigins = [
    'https://gloom-design.github.io',
    'https://costcal-peach.vercel.app',
    'https://costcal-test.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500'
  ];

  const origin = req.headers.origin;

  res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Forbidden', apiVersion: 'v7.6.3' });

  let { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v7.6.3' });

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();
  let resolvedName = queryTerm;

  try {
    if (/^\d{4}$/.test(queryTerm) || /[\u4e00-\u9fa5]/.test(queryTerm)) {
      if (/^\d{4}$/.test(queryTerm)) {
        finalSymbol = queryTerm + '.TW';
      } else {
        const listRes = await safeFetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (listRes && listRes.ok) {
          const stockList = await listRes.json();
          const found = stockList.find(item => item.Name && item.Name.includes(queryTerm));
          if (found && found.Code) { finalSymbol = found.Code + '.TW'; resolvedName = found.Name.trim(); }
        }
      }

      let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
      let response = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      
      if ((!response || !response.ok) && finalSymbol.endsWith('.TW')) {
        finalSymbol = finalSymbol.replace('.TW', '.TWO');
        url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
        response = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      }

      if (!response || !response.ok) return res.status(400).json({ error: `找不到代號 ${finalSymbol} 的市場資料`, apiVersion: 'v7.6.3' });
      
      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;
      if (!meta) return res.status(400).json({ error: '查無資料', apiVersion: 'v7.6.3' });

      const currentPrice = meta.preMarketPrice || meta.postMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose;
      return res.status(200).json({ symbol: meta.symbol || finalSymbol, name: resolvedName, currentPrice: Number(currentPrice), prevClose: Number(meta.chartPreviousClose || currentPrice), apiVersion: 'v7.6.3 (TW)' });

    } else {
      const robinhoodData = await fetchRobinhoodPrice(finalSymbol);
      if (robinhoodData) return res.status(200).json({ ...robinhoodData, apiVersion: 'v7.6.3 (Robinhood 24h)' });

      const webullData = await fetchWebull24hPrice(finalSymbol);
      if (webullData) return res.status(200).json({ ...webullData, apiVersion: 'v7.6.3 (Webull 24h)' });

      const searchRes = await safeFetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1&newsCount=0`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (searchRes && searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData?.quotes?.length > 0) {
          finalSymbol = searchData.quotes[0].symbol;
          resolvedName = searchData.quotes[0].shortname || queryTerm;
        }
      }

      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d&includePrePost=true`;
      const response = await safeFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response || !response.ok) return res.status(400).json({ error: `查無資料`, apiVersion: 'v7.6.3' });

      const data = await response.json();
      const meta = data.chart?.result?.[0]?.meta;
      const currentPrice = meta.preMarketPrice || meta.postMarketPrice || meta.regularMarketPrice || meta.chartPreviousClose;
      
      return res.status(200).json({ symbol: meta.symbol || finalSymbol, name: resolvedName, currentPrice: Number(currentPrice), prevClose: Number(meta.chartPreviousClose || currentPrice), apiVersion: 'v7.6.3 (Yahoo Backup)' });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v7.6.3' });
  }
}
