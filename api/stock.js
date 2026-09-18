// CostCal Stock API - Version v0
// API Endpoint: https://costcal-test.vercel.app/api/stock
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: '請提供股票代號 (symbol)' });
  }

  symbol = symbol.trim().toUpperCase();

  // 💡 專屬版本檢測與心跳攔截：直接秒回，不連線至 Yahoo
  if (symbol === 'PING') {
    return res.status(200).json({
      status: 'ok',
      apiVersion: 'v0'
    });
  }

  let querySymbols = symbol;

  if (/^\d{4,5}$/.test(symbol)) {
    querySymbols = `${symbol}.TW,${symbol}.TWO`;
  }

  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${querySymbols}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo API 回應錯誤: ${response.status}`);
    }

    const data = await response.json();
    const results = data?.quoteResponse?.result;

    if (!results || results.length === 0) {
      return res.status(404).json({ error: '查無此股票代號' });
    }

    const quote = results[0];

    return res.status(200).json({
      symbol: quote.symbol,
      name: quote.longName || quote.shortName || quote.symbol,
      currentPrice: quote.regularMarketPrice,
      prevClose: quote.regularMarketPreviousClose,
      apiVersion: 'v0'
    });

  } catch (error) {
    console.error('API 查詢錯誤:', error);
    return res.status(500).json({ error: '伺服器擷取報價失敗，請稍後再試' });
  }
}
