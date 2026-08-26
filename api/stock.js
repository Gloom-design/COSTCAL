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

  // 1. 如果輸入的不是標準代號格式（夾帶中文或純文字），透過公開網路搜尋端點動態找出正確代號
  if (/[\u4e00-\u9fa5]/.test(queryTerm) || !/^[A-Z0-9.]+$/i.test(queryTerm)) {
    try {
      // 串接公開財經搜尋網路資源以動態取得代號
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(queryTerm)}&quotesCount=5&newsCount=0`;
      const searchRes = await fetch(searchUrl, { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' 
        } 
      });
      const searchData = await searchRes.json();
      
      // 從網路搜尋結果中挑選最適合的台股代號 (.TW 或 .TWO)
      const quotes = searchData.quotes || [];
      const twMatch = quotes.find(q => q.symbol && (q.symbol.endsWith('.TW') || q.symbol.endsWith('.TWO')));
      const anyMatch = quotes[0];

      if (twMatch) {
        finalSymbol = twMatch.symbol;
      } else if (anyMatch && anyMatch.symbol) {
        finalSymbol = anyMatch.symbol;
      }
    } catch (e) {
      // 網路搜尋若遇阻礙，則退回純代號拼貼邏輯
    }
  }

  // 2. 如果是純 4 碼數字，自動嘗試標準台股後綴網路結點
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
    
    // 如果 .TW 網路節點失敗，動態切換嘗試 .TWO 櫃買中心網路節點
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      throw new Error(`找不到該代號或網路行情取得失敗`);
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
