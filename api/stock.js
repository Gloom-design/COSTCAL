// CostCal Stock API - Version v0.2
// API Endpoint: https://costcal-test.vercel.app/api/stock

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchFromYahooChart(symbol) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  
  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) continue;

      const data = await response.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) continue;

      const quoteIndicators = data?.chart?.result?.[0]?.indicators?.quote?.[0];
      let currentPrice = meta.regularMarketPrice;
      if (currentPrice === undefined || currentPrice === null) {
        const closes = quoteIndicators?.close?.filter(c => c !== null && c !== undefined);
        if (closes && closes.length > 0) {
          currentPrice = closes[closes.length - 1];
        }
      }

      let prevClose = meta.chartPreviousClose ?? meta.previousClose;
      if (prevClose === undefined || prevClose === null) {
        prevClose = currentPrice;
      }

      if (currentPrice !== undefined && currentPrice !== null) {
        return {
          symbol: meta.symbol || symbol,
          name: meta.longName || meta.shortName || meta.symbol || symbol,
          currentPrice: Number(currentPrice),
          prevClose: Number(prevClose)
        };
      }
    } catch (err) {
      console.warn(`Yahoo Chart [${host}] for ${symbol} failed:`, err.message);
    }
  }

  return null;
}

async function fetchFromTwseMis(code) {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw|otc_${code}.tw`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const item = data?.msgArray?.find(x => x.c === code && (x.z || x.y || x.pz));
    if (!item) return null;

    const parseNum = (val) => {
      if (!val || val === '-') return null;
      const num = parseFloat(val);
      return isNaN(num) ? null : num;
    };

    let currentPrice = parseNum(item.z) ?? parseNum(item.pz) ?? parseNum(item.y);
    let prevClose = parseNum(item.y) ?? currentPrice;

    if (currentPrice !== null && currentPrice !== undefined) {
      const isOtc = item.ex === 'otc';
      return {
        symbol: `${code}.${isOtc ? 'TWO' : 'TW'}`,
        name: item.n || item.nf || code,
        currentPrice: Number(currentPrice),
        prevClose: Number(prevClose)
      };
    }
  } catch (err) {
    console.warn(`TWSE MIS fetch failed for ${code}:`, err.message);
  }

  return null;
}

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

  // 💡 心跳與版本檢測：秒回
  if (symbol === 'PING') {
    return res.status(200).json({
      status: 'ok',
      apiVersion: 'v0.2'
    });
  }

  try {
    let result = null;

    // 1. 判斷是否為台股代號 (4至5碼數字，例如 2330, 3665, 0050, 00878, 或帶有 .TW / .TWO)
    const twMatch = symbol.match(/^(\d{4,5})(\.(TW|TWO))?$/);

    if (twMatch) {
      const pureCode = twMatch[1];
      
      // 優先嘗試台灣證券交易所官方即時行情 (可取得即時成交價與精準中文名稱)
      result = await fetchFromTwseMis(pureCode);

      // 若證交所 API 未取得，改由 Yahoo Chart API 查詢 (.TW 或 .TWO)
      if (!result) {
        result = await fetchFromYahooChart(`${pureCode}.TW`);
      }
      if (!result) {
        result = await fetchFromYahooChart(`${pureCode}.TWO`);
      }
    } else {
      // 2. 美股或其他代號 (如 AAPL, TSLA, NVDA, BRK-B 等)
      // 轉換美股代號可能使用的點為連字號 (例 BRK.B -> BRK-B)
      const yahooSymbol = symbol.replace(/\./g, '-');
      result = await fetchFromYahooChart(yahooSymbol);
    }

    if (!result) {
      return res.status(404).json({ error: '查無此股票代號行情或代號不存在' });
    }

    return res.status(200).json({
      symbol: result.symbol,
      name: result.name,
      currentPrice: result.currentPrice,
      prevClose: result.prevClose,
      apiVersion: 'v0.2'
    });

  } catch (error) {
    console.error('API 查詢異常:', error);
    return res.status(500).json({ error: '伺服器擷取報價失敗，請稍後再試' });
  }
}
