import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "prototype");
const secretsFile = path.join(root, "data", "secrets.json");
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 2 * 1024 * 1024;

let aiConfig = {
  provider: process.env.AI_PROVIDER || "zhipu",
  apiKey: process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || "",
  textModel: process.env.ZHIPU_TEXT_MODEL || process.env.OPENAI_MODEL || "glm-4.7-flash",
  visionModel: process.env.ZHIPU_VISION_MODEL || "glm-4.6v-flash",
  connectionStatus: process.env.ZHIPU_API_KEY ? "connected" : "untested",
  lastTestedAt: null,
  lastError: null
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const marketPeriods = {
  "5D": { range: "5d", interval: "1d" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1wk" }
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("请求内容超过 2MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function loadLocalAiConfig() {
  if (process.env.VERCEL || aiConfig.apiKey) return;
  try {
    const stored = JSON.parse(await fs.readFile(secretsFile, "utf8"));
    aiConfig = {
      ...aiConfig,
      ...stored,
      apiKey: stored.apiKey || aiConfig.apiKey,
      connectionStatus: stored.apiKey ? stored.connectionStatus || "connected" : "untested"
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取 AI 配置失败", error);
  }
}

async function saveLocalAiConfig() {
  if (process.env.VERCEL) return;
  await fs.mkdir(path.dirname(secretsFile), { recursive: true });
  await fs.writeFile(secretsFile, `${JSON.stringify(aiConfig, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(secretsFile, 0o600);
}

function publicAiConfig() {
  return {
    provider: aiConfig.provider,
    configured: Boolean(aiConfig.apiKey),
    keyHint: aiConfig.apiKey ? `••••${aiConfig.apiKey.slice(-4)}` : "",
    textModel: aiConfig.textModel,
    visionModel: aiConfig.visionModel,
    connectionStatus: aiConfig.apiKey ? aiConfig.connectionStatus : "untested",
    lastTestedAt: aiConfig.lastTestedAt,
    lastError: aiConfig.lastError
  };
}

async function testZhipuConnection(config = aiConfig) {
  if (!config.apiKey) throw new Error("请填写智谱 API Key");
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.textModel,
      messages: [{ role: "user", content: "只回复 OK" }],
      temperature: 0,
      max_tokens: 8
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`连接失败（${response.status}）：${body.slice(0, 240)}`);
  }
}

async function updateAiSettings(req, res) {
  if (process.env.VERCEL) {
    return json(res, 400, {
      settings: publicAiConfig(),
      error: "线上版本请在 Vercel Environment Variables 中配置 ZHIPU_API_KEY"
    });
  }

  const body = await readJson(req);
  const candidate = {
    ...aiConfig,
    provider: "zhipu",
    apiKey: String(body.apiKey || "").trim() || aiConfig.apiKey,
    textModel: String(body.textModel || aiConfig.textModel).trim(),
    visionModel: String(body.visionModel || aiConfig.visionModel).trim()
  };

  try {
    await testZhipuConnection(candidate);
    aiConfig = {
      ...candidate,
      connectionStatus: "connected",
      lastTestedAt: new Date().toISOString(),
      lastError: null
    };
    await saveLocalAiConfig();
    return json(res, 200, { settings: publicAiConfig(), message: "智谱 AI 连接成功" });
  } catch (error) {
    aiConfig = {
      ...candidate,
      connectionStatus: "error",
      lastTestedAt: new Date().toISOString(),
      lastError: error.message
    };
    await saveLocalAiConfig();
    return json(res, 400, { settings: publicAiConfig(), error: error.message });
  }
}

async function callZhipuText(model, messages) {
  if (aiConfig.provider !== "zhipu" || !aiConfig.apiKey) {
    throw new Error("AI 尚未连接，请先配置智谱 API Key");
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${aiConfig.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.35,
        max_tokens: 900
      })
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error("GLM 没有返回可用内容");
      return String(content).trim();
    }

    const error = await response.text();
    lastError = new Error(`AI 生成失败：${response.status} ${error.slice(0, 300)}`);
    if (response.status !== 429 || attempt === 2) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (2 ** attempt)));
  }
  throw lastError;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function textToHtml(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return "";
  return cleaned
    .split(/\n{2,}/)
    .map((paragraph) => {
      const line = escapeHtml(paragraph)
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
      return `<p>${line}</p>`;
    })
    .join("");
}

function formatMarketLabel(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric"
  });
}

async function fetchYahooChart(symbol, period = "1M") {
  const config = marketPeriods[period] || marketPeriods["1M"];
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", config.range);
  url.searchParams.set("interval", config.interval);
  url.searchParams.set("includePrePost", "false");

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${symbol} 行情源请求失败（${response.status}）：${body.slice(0, 240)}`);
  }

  const body = await response.json();
  const result = body.chart?.result?.[0];
  const apiError = body.chart?.error;
  if (!result || apiError) {
    throw new Error(`${symbol} 行情源没有返回数据：${apiError?.description || "empty result"}`);
  }

  return result;
}

function normalizeYahooMarket(result, sourceSymbol, period) {
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const meta = result.meta || {};
  const points = timestamps
    .map((timestamp, index) => ({
      timestamp,
      label: formatMarketLabel(timestamp),
      close: [closes[index], opens[index], highs[index], lows[index]].find((value) => Number.isFinite(value))
    }))
    .filter((point) => Number.isFinite(point.close));

  const price = Number.isFinite(meta.regularMarketPrice)
    ? meta.regularMarketPrice
    : points.length
      ? points[points.length - 1].close
      : null;
  if (!Number.isFinite(price)) {
    throw new Error(`${sourceSymbol} 行情源返回的数据没有可用价格`);
  }

  if (!points.length) {
    const timestamp = meta.regularMarketTime || Math.floor(Date.now() / 1000);
    points.push({
      timestamp,
      label: formatMarketLabel(timestamp),
      close: price
    });
  }

  const previousClose = Number.isFinite(meta.previousClose)
    ? meta.previousClose
    : Number.isFinite(meta.chartPreviousClose)
      ? meta.chartPreviousClose
      : points[Math.max(points.length - 2, 0)].close;
  const change = price - previousClose;
  const changePct = previousClose ? (change / previousClose) * 100 : 0;
  const updatedAt = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    symbol: "00068.HK",
    name: "群核科技",
    currency: meta.currency || "HKD",
    exchangeName: meta.exchangeName || "HKG",
    sourceSymbol,
    price,
    previousClose,
    change,
    changePct,
    updatedAt,
    period,
    labels: points.map((point) => point.label),
    data: points.map((point) => Number(point.close.toFixed(3))),
    source: `Yahoo Finance (${sourceSymbol})`
  };
}

async function fetchQunheMarket(period = "1M") {
  const aliases = ["00068.HK", "0068.HK"];
  const periods = [...new Set([period, "5D"])];
  const errors = [];

  for (const currentPeriod of periods) {
    for (const symbol of aliases) {
      try {
        const result = await fetchYahooChart(symbol, currentPeriod);
        const market = normalizeYahooMarket(result, symbol, currentPeriod);
        return { ...market, requestedPeriod: period };
      } catch (error) {
        errors.push(`${currentPeriod}/${symbol}: ${error.message}`);
      }
    }
  }

  throw new Error(`实时行情获取失败：${errors.join("；")}`);
}

async function getMarketQuote(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const period = url.searchParams.get("period") || "1M";
  const market = await fetchQunheMarket(period);
  return json(res, 200, market);
}

async function fetchHkdCnyRate() {
  const response = await fetch("https://api.frankfurter.app/latest?from=HKD&to=CNY", {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`汇率源请求失败（${response.status}）：${body.slice(0, 240)}`);
  }
  const body = await response.json();
  const rate = body.rates?.CNY;
  if (!Number.isFinite(rate)) {
    throw new Error("汇率源没有返回 HKD/CNY 数据");
  }
  return {
    base: "HKD",
    quote: "CNY",
    rate,
    date: body.date,
    updatedAt: new Date().toISOString(),
    source: "Frankfurter"
  };
}

async function getMarketRate(req, res) {
  return json(res, 200, await fetchHkdCnyRate());
}

function quheContext(metrics = {}) {
  const price = Number(metrics.price) || 0;
  const rate = Number(metrics.rate) || 0;
  const shares = Number(metrics.shares) || 0;
  const gross = Number(metrics.gross) || 0;
  const tax = Number(metrics.tax) || 0;
  const net = Number(metrics.net) || 0;
  const years = Number(metrics.years) || 0;
  return [
    `当前股价：${price.toFixed(2)} HKD`,
    `HKD/CNY 汇率：${rate.toFixed(4)}`,
    `行权股数：${shares.toLocaleString("zh-CN")} 股，总期权 150,000 股`,
    "行权价：0.025 CNY/股",
    `税前所得估算：${Math.round(gross).toLocaleString("zh-CN")} CNY`,
    `个税估算：${Math.round(tax).toLocaleString("zh-CN")} CNY，使用一次性股票期权收入分月摊计的简化估算`,
    `税后到手估算：${Math.round(net).toLocaleString("zh-CN")} CNY`,
    `相当于月盈余 23,000 CNY 的 ${years.toFixed(1)} 年`
  ].join("\n");
}

async function analyzeQunhe(req, res) {
  const metrics = await readJson(req);
  const content = await callZhipuText(aiConfig.textModel, [
    {
      role: "system",
      content: "你是一个谨慎的个人期权行权决策助手。你只基于用户给出的参数做估算和决策辅助，不编造实时行情，不承诺收益，不构成投资、税务或法律建议。输出中文，分为三段：当前价位评估、核心风险、行动建议。每段 2-3 句，简洁具体。"
    },
    {
      role: "user",
      content: `请基于以下群核科技 00068.HK 期权数据生成分析：\n${quheContext(metrics)}`
    }
  ]);
  return json(res, 200, { html: textToHtml(content), text: content });
}

async function chatQunhe(req, res) {
  const body = await readJson(req);
  const question = String(body.question || "").trim();
  const clientTime = String(body.clientTime || "").trim();
  if (!question) return json(res, 400, { error: "问题不能为空" });
  const content = await callZhipuText(aiConfig.textModel, [
    {
      role: "system",
      content: "你是群核期权助手。请直接回答用户问题，并结合用户当前参数说明估算逻辑、风险和行动边界。不要声称知道实时行情或最新公告；如果问题需要外部事实，明确说需要用户补充或接入数据源。中文回答，控制在 180 字以内。"
    },
    {
      role: "user",
      content: `当前时间（Asia/Shanghai）：${clientTime || "未提供"}\n\n当前参数：\n${quheContext(body.metrics)}\n\n用户问题：${question}`
    }
  ]);
  return json(res, 200, { html: textToHtml(content), text: content });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const resolved = path.resolve(publicDir, requested);
  if (!resolved.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const data = await fs.readFile(resolved);
    res.writeHead(200, {
      "content-type": mimeTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, {
        ok: true,
        aiEnabled: Boolean(aiConfig.apiKey),
        ai: publicAiConfig()
      });
    }
    if (req.method === "GET" && url.pathname === "/api/settings/ai") {
      return json(res, 200, { settings: publicAiConfig() });
    }
    if (req.method === "PUT" && url.pathname === "/api/settings/ai") {
      return await updateAiSettings(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/market/quote") {
      return await getMarketQuote(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/market/rate") {
      return await getMarketRate(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/quhe/analyze") {
      return await analyzeQunhe(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/quhe/chat") {
      return await chatQunhe(req, res);
    }
    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { error: "接口不存在" });
    }
    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || "服务器错误" });
  }
}

await loadLocalAiConfig();

export default handleRequest;

if (!process.env.VERCEL) {
  const server = http.createServer(handleRequest);
  server.listen(port, "127.0.0.1", () => {
    console.log(`群核期权助手已启动：http://127.0.0.1:${port}`);
    console.log(
      aiConfig.apiKey
        ? `智谱 AI 已配置：文本 ${aiConfig.textModel} / 图片 ${aiConfig.visionModel}，连接状态 ${aiConfig.connectionStatus}`
        : "智谱 AI 尚未启用；在页面 AI 设置中保存 API Key 后即可使用"
    );
  });
}
