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

  // 如果包含中文，透過公開的台灣股市代號開放資料庫進行即時動態比對檢索
  if (/[\u4e00-\u9fa5]/.test(queryTerm)) {
    try {
      // 抓取證交所與櫃買中心公開的即時證券代號對照 JSON
      const listRes = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (listRes.ok) {
        const stockList = await listRes.json();
        // 動態從全國上市股票中尋找名稱包含或符合該中文的項目
        const found = stockList.find(item => item.Name && item.Name.includes(queryTerm));
        if (found && found.Code) {
          finalSymbol = found.Code + '.TW';
        }
      }

      // 如果上市找不到，到櫃買中心 (OTC) 開放資料尋找
      if (!finalSymbol.includes('.TW') && !finalSymbol.includes('.TWO')) {
        const otcRes = await fetch('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O', {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (otcRes.ok) {
          const otcList = await otcRes.json();
          const foundOtc = otcList.find(item => item.CompanyName && item.CompanyName.includes(queryTerm));
          if (foundOtc && foundOtc.CompanyCode) {
            finalSymbol = foundOtc.CompanyCode + '.TWO';
          }
        }
      }
    } catch (e) {
      // 網路動態檢索若有狀況則嘗試直接組裝
    }
  }

  // 若仍只是純 4 碼，預設補上 .TW
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
    
    // 若 .TW 失敗，自動切換至 .TWO 櫃買中心結點
    if (!response.ok && finalSymbol.endsWith('.TW')) {
      finalSymbol = finalSymbol.replace('.TW', '.TWO');
      url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(finalSymbol)}?interval=1d&range=1d`;
      response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    }

    if (!response.ok) {
      throw new Error(`找不到該代號或行情取得失敗`);
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
