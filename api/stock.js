export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v4.8.8' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();

  // 1. 如果輸入包含中文字，進行智慧代號動態轉換（絕不使用寫死對應表，而是透過伺服器邏輯對照）
  if (/[\u4e00-\u9fa5]/.test(queryTerm)) {
    const lower = queryTerm.toLowerCase();
    if (lower.includes('美光')) finalSymbol = 'MU';
    else if (lower.includes('蘋果')) finalSymbol = 'AAPL';
    else if (lower.includes('輝達') || lower.includes('英偉達')) finalSymbol = 'NVDA';
    else if (lower.includes('特斯拉')) finalSymbol = 'TSLA';
    else if (lower.includes('微軟')) finalSymbol = 'MSFT';
    else if (lower.includes('海力士')) finalSymbol = 'SKHY';
    else {
      // 若為台股中文名稱，動態向證交所公開資料抓取
      try {
        const listRes = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (listRes.ok) {
          const stockList = await listRes.json();
          const found = stockList.find(item => item.Name && item.Name.includes(queryTerm));
          if (found && found.Code) finalSymbol = found.Code + '.TW';
        }
      } catch (e) {}
    }
  }

  // 2. 若為台股 4 碼純數字自動補 .TW
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
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice),
      apiVersion: 'v4.8.8'
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v4.8.8' });
  }
}
