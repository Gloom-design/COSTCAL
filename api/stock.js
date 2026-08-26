export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: 'Missing symbol', apiVersion: 'v4.9.7' });
  }

  let queryTerm = symbol.trim();
  let finalSymbol = queryTerm.toUpperCase();
  let resolvedName = queryTerm;

  try {
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

      // 2. 若不是台股，透過公開的 DuckDuckGo API 協助動態搜尋美股英文代號（完美支援中文關鍵字）
      if (!foundTw) {
        try {
          const ddgRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(queryTerm + ' stock symbol')}&format=json`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });
          if (ddgRes.ok) {
            const ddgData = await ddgRes.json();
            // 從文字摘要中萃取出可能的 1~5 位大寫英文代號
            const textToSearch = (ddgData.Abstract || '') + ' ' + (ddgData.Heading || '') + ' ' + (JSON.stringify(ddgData.RelatedTopics) || '');
            const match = textToSearch.match(/\b([A-Z]{1,5})\b/g);
            if (match && match.length > 0) {
              // 排除常見的英文單字，抓取最可能的代號
              const excludeWords = ['THE', 'AND', 'FOR', 'STOCK', 'NYSE', 'NASDAQ', 'INC', 'CORP', 'CO'];
              const validSymbol = match.find(m => !excludeWords.includes(m));
              if (validSymbol) {
                finalSymbol = validSymbol;
              }
            }
          }
        } catch (e) {}

        // 若 DuckDuckGo 沒抓到，改用 Yahoo 官方搜尋備援
        if (/[\u4e00-\u9fa5]/.test(finalSymbol)) {
          try {
            const ySearch = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=1&newsCount=0`, {
              headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (ySearch.ok) {
              const yData = await ySearch.json();
              if (yData.quotes && yData.quotes.length > 0 && yData.quotes[0].symbol) {
                finalSymbol = yData.quotes[0].symbol;
              }
            }
          } catch (e) {}
        }
      }
    }

    // 若為台股 4 碼純數字自動補 .TW
    if (/^\d{4}$/.test(finalSymbol)) {
      finalSymbol += '.TW';
    }

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
      return res.status(400).json({ error: `找不到代號 ${finalSymbol} 的市場資料，請嘗試直接輸入英文代號（如 ONON）`, apiVersion: 'v4.9.7' });
    }
    
    const data = await response.json();
    const result = data.chart?.result?.[0];
    
    if (!result) {
      return res.status(400).json({ error: '查無市場資料', apiVersion: 'v4.9.7' });
    }

    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
    const prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;

    return res.status(200).json({
      symbol: meta.symbol || finalSymbol,
      name: resolvedName,
      currentPrice: Number(currentPrice),
      prevClose: Number(prevClose || currentPrice),
      apiVersion: 'v4.9.7'
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, apiVersion: 'v4.9.7' });
  }
}
