export default async function handler(req, res) {
  // 1. 設定 CORS (跨域資源共用) 標頭，允許您的 PWA 前端呼叫
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*'); // 或鎖定您的網域
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 攔截 OPTIONS 預檢請求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 2. 取得並驗證前端傳來的股票代號 (symbol)
  let { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: '請提供股票代號 (symbol)' });
  }

  symbol = symbol.trim().toUpperCase();
  let querySymbols = symbol;

  // 💡 智慧判斷邏輯：如果是純數字 (台股)，同時查詢上市 (.TW) 與上櫃 (.TWO)
  if (/^\d{4,5}$/.test(symbol)) {
    querySymbols = `${symbol}.TW,${symbol}.TWO`;
  }

  try {
    // 3. 向 Yahoo Finance 請求即時報價資料
    // 使用 v7 quote API 可以一次拿到市價、昨收與名稱
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${querySymbols}`;
    const response = await fetch(url, {
      headers: {
        // 偽裝成瀏覽器，避免被 Yahoo 阻擋
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo API 回應錯誤: ${response.status}`);
    }

    const data = await response.json();
    const results = data?.quoteResponse?.result;

    // 4. 若查無資料的防護處理
    if (!results || results.length === 0) {
      return res.status(404).json({ error: '查無此股票代號' });
    }

    // 因為我們可能同時查了 .TW 和 .TWO，這裡取陣列中的第一筆有效結果即可
    const quote = results[0];

    // 5. 整理並回傳符合前端格式的 JSON
    return res.status(200).json({
      symbol: quote.symbol,
      name: quote.longName || quote.shortName || quote.symbol,
      currentPrice: quote.regularMarketPrice,
      prevClose: quote.regularMarketPreviousClose,
      apiVersion: 'v7.8.38 PWA' // 這會對應更新前端介面上的綠色標籤
    });

  } catch (error) {
    console.error('API 查詢錯誤:', error);
    return res.status(500).json({ error: '伺服器擷取報價失敗，請稍後再試' });
  }
}
