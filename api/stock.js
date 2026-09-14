import yahooFinance from 'yahoo-finance2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: '缺少股票代號參數 (symbol)' });
  }

  let querySymbol = symbol.trim().toUpperCase();
  
  // 自動判斷台股代號字尾
  if (/^\d{4}$/.test(querySymbol)) {
    querySymbol = `${querySymbol}.TW`;
  }

  try {
    const quote = await yahooFinance.quote(querySymbol);
    if (!quote || quote.regularMarketPrice === undefined) {
      throw new Error(`無法取得代號 ${querySymbol} 的市場報價`);
    }

    return res.status(200).json({
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || querySymbol,
      currentPrice: quote.regularMarketPrice,
      prevClose: quote.regularMarketPrice - (quote.regularMarketChange || 0),
      changePercent: quote.regularMarketChangePercent || 0,
      apiVersion: 'v7.8.13 (Stable Local-First)'
    });
  } catch (error) {
    // 若 .TW 失敗嘗試 .TWO (上櫃)
    if (/^\d{4}\.TW$/.test(querySymbol)) {
      try {
        const altSymbol = querySymbol.replace('.TW', '.TWO');
        const quoteAlt = await yahooFinance.quote(altSymbol);
        if (quoteAlt && quoteAlt.regularMarketPrice !== undefined) {
          return res.status(200).json({
            symbol: quoteAlt.symbol,
            name: quoteAlt.shortName || quoteAlt.longName || altSymbol,
            currentPrice: quoteAlt.regularMarketPrice,
            prevClose: quoteAlt.regularMarketPrice - (quoteAlt.regularMarketChange || 0),
            changePercent: quoteAlt.regularMarketChangePercent || 0,
            apiVersion: 'v7.8.13 (Stable Local-First)'
          });
        }
      } catch (err2) {}
    }

    return res.status(500).json({ 
      error: `查詢失敗: ${error.message}`,
      apiVersion: 'v7.8.13 (Error)'
    });
  }
}
