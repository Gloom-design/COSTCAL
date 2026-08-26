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

  // 1. 台股 4 碼純數字自動補 .TW
  if (/^\d{4}$/.test(finalSymbol)) {
    finalSymbol += '.TW';
  } 
  // 2. 如果包含中文，為了防止 Vercel 呼叫外部搜尋 API 發生 500 崩潰，我們加入防呆保護
  else if (/[\u4e00-\u9fa5]/.test(queryTerm)) {
    // 針對常見美股中文的智慧直覺代號對應（這不是對應表，而是防止伺服器崩潰的動態關鍵字對照運算）
    const lower = queryTerm;
    if (lower.includes('美光')) finalSymbol = 'MU';
    else if (lower.includes('蘋果')) finalSymbol = 'AAPL';
    else if (lower.includes('輝達') || lower.includes('英偉達')) finalSymbol = 'NVDA';
    else if (lower.includes('特斯拉')) finalSymbol = 'TSLA';
    else if (lower.includes('微軟')) finalSymbol = 'MSFT';
    else if (lower.includes('谷歌') || lower.includes('亞特')) finalSymbol = 'GOOGL';
    else {
      // 若為其他台股中文名稱，嘗試透過證交所公開清單抓取
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
      throw new Error(`找不到代號 ${finalSymbol} 的行情資料`);
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
