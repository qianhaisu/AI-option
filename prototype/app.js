const EXERCISE_PRICE_CNY = 0.025;
const TOTAL_SHARES = 150000;
const MONTHLY_SURPLUS = 23000;
const MILLION_TARGET = 1000000;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let currentPeriod = "1M";
let latestMetrics = null;
let toastTimer = null;

const periodConfigs = {
  "1M": { days: 30, base: 20.5, vol: 0.45 },
  "3M": { days: 90, base: 18, vol: 0.5 },
  "6M": { days: 180, base: 15.5, vol: 0.55 },
  "1Y": { days: 365, base: 12, vol: 0.6 }
};

function formatCurrency(value) {
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

function genPriceData(period) {
  const cfg = periodConfigs[period];
  const labels = [];
  const data = [];
  let price = cfg.base;
  const now = new Date();
  for (let i = cfg.days; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    labels.push(date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" }));
    price += (Math.random() - 0.49) * cfg.vol;
    price = Math.max(price, cfg.base * 0.6);
    data.push(Number(price.toFixed(2)));
  }
  data[data.length - 1] = Number($("#price").value) || 19.62;
  return { labels, data };
}

function renderChart(period = currentPeriod) {
  currentPeriod = period;
  const { labels, data } = genPriceData(period);
  const first = data[0];
  const last = data[data.length - 1];
  const isUp = last >= first;
  const color = isUp ? "#059669" : "#dc2626";
  const canvas = $("#stock-chart");
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const padding = { top: 12, right: 10, bottom: 26, left: 40 };
  const width = rect.width - padding.left - padding.right;
  const height = rect.height - padding.top - padding.bottom;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const spread = Math.max(max - min, 1);
  const yFor = (value) => padding.top + (max - value) / spread * height;
  const xFor = (index) => padding.left + index / Math.max(data.length - 1, 1) * width;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "#f0f1f5";
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (height / 4) * i;
    const value = max - (spread / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(rect.width - padding.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), padding.left - 8, y);
  }

  ctx.save();
  ctx.beginPath();
  data.forEach((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(data.length - 1), padding.top + height);
  ctx.lineTo(xFor(0), padding.top + height);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + height);
  gradient.addColorStop(0, isUp ? "rgba(5,150,105,0.16)" : "rgba(220,38,38,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  data.forEach((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  const tickIndexes = [0, Math.floor(data.length / 2), data.length - 1];
  ctx.fillStyle = "#9ca3af";
  ctx.textBaseline = "top";
  tickIndexes.forEach((index, tick) => {
    ctx.textAlign = tick === 0 ? "left" : tick === 1 ? "center" : "right";
    ctx.fillText(labels[index], xFor(index), padding.top + height + 10);
  });

  const delta = last - first;
  const pct = first ? (delta / first) * 100 : 0;
  $("#display-change").textContent = `${isUp ? "▲" : "▼"} ${delta.toFixed(2)} (${pct.toFixed(2)}%)`;
  $("#display-change").className = `stock-change ${isUp ? "up" : "down"}`;
}

function calcTax(income) {
  const monthly = income / 12;
  let rate = 0.03;
  let deduct = 0;
  if (monthly <= 3000) [rate, deduct] = [0.03, 0];
  else if (monthly <= 12000) [rate, deduct] = [0.1, 210];
  else if (monthly <= 25000) [rate, deduct] = [0.2, 1410];
  else if (monthly <= 35000) [rate, deduct] = [0.25, 2660];
  else if (monthly <= 55000) [rate, deduct] = [0.3, 4410];
  else if (monthly <= 80000) [rate, deduct] = [0.35, 7160];
  else [rate, deduct] = [0.45, 15160];
  return Math.max((monthly * rate - deduct) * 12, 0);
}

function calculate() {
  const price = Number($("#price").value) || 0;
  const rate = Number($("#rate").value) || 0;
  const shares = Number($("#shares-slider").value) || 0;
  const priceCny = price * rate;
  const gross = Math.max((priceCny - EXERCISE_PRICE_CNY) * shares, 0);
  const tax = gross > 0 ? calcTax(gross) : 0;
  const net = Math.max(gross - tax, 0);
  const years = net / (MONTHLY_SURPLUS * 12);

  latestMetrics = { price, rate, shares, priceCny, gross, tax, net, years };

  $("#gross").textContent = gross ? formatCurrency(gross) : "¥--";
  $("#tax").textContent = gross ? `-${formatCurrency(tax)}` : "¥--";
  $("#net").textContent = gross ? formatCurrency(net) : "¥--";
  $("#net-wan").textContent = gross ? (net / 10000).toFixed(1) : "--";
  $("#display-price").textContent = price.toFixed(2);

  if (gross) {
    const gap = MILLION_TARGET - net;
    $("#million-value").textContent = `¥${Math.round(net / 10000)}万`;
    $("#million-sub").textContent = gap <= 0
      ? `超出百万目标 ${formatCurrency(Math.abs(gap))}`
      : `距百万还差 ${formatCurrency(gap)}`;
    $("#million-tag").textContent = gap <= 0 ? "已达成" : "未达成";
    $("#million-tag").style.background = gap <= 0 ? "#059669" : "#d97706";
    $("#years-value").textContent = `${years.toFixed(1)} 年`;
    $("#years-tag").textContent = `= ${Math.round(years * 12)} 个月盈余`;
  } else {
    $("#million-value").textContent = "¥--";
    $("#million-sub").textContent = "税后到手是否超过 ¥100 万";
    $("#million-tag").textContent = "计算中";
    $("#years-value").textContent = "-- 年";
    $("#years-tag").textContent = "计算中";
  }
}

function updateShares(value) {
  const shares = Number(value);
  const pct = (shares / TOTAL_SHARES) * 100;
  $("#shares-display").textContent = shares.toLocaleString("zh-CN");
  $("#shares-pct").textContent = `${pct.toFixed(1)}%`;
  $("#shares-keep").textContent = (TOTAL_SHARES - shares).toLocaleString("zh-CN");
  $("#shares-slider").style.background =
    `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--surface-2) ${pct}%)`;
  $$("#quick-shares button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.shares) === shares);
  });
  calculate();
}

function localAnalysis() {
  const { price, rate, shares, net, years } = latestMetrics;
  const shareText = shares.toLocaleString("zh-CN");
  const riskLine = price >= 18
    ? "当前价格相对你的行权价安全垫非常厚，主要风险不在是否值得行权，而在卖出节奏和解禁期波动。"
    : "当前价格仍有正收益，但安全垫已经明显收窄，建议把止损线和执行窗口写清楚。";
  return `
    <h3>当前价位评估</h3>
    按 <strong>${price.toFixed(2)} HKD</strong>、汇率 <strong>${rate.toFixed(4)}</strong>、行权 <strong>${shareText} 股</strong> 估算，税后到手约 <strong>${formatCurrency(net)}</strong>。
    <h3>核心判断</h3>
    ${riskLine} 这笔现金相当于约 <strong>${years.toFixed(1)} 年</strong>月盈余。
    <h3>行动建议</h3>
    继续以“卖 2/3、保留 1/3”为基础方案。若临近解禁出现连续放量回调，可考虑提高卖出比例；若价格稳定在 18 HKD 以上，优先保证行权日卖出动作确定执行。
  `;
}

function localReply(question) {
  const q = question.toLowerCase();
  if (q.includes("15") || q.includes("跌")) {
    const price = 15;
    const rate = Number($("#rate").value) || 0.9213;
    const shares = Number($("#shares-slider").value) || 100000;
    const gross = Math.max((price * rate - EXERCISE_PRICE_CNY) * shares, 0);
    const tax = calcTax(gross);
    const net = gross - tax;
    return `按 15 HKD 和当前汇率估算，行权 ${shares.toLocaleString("zh-CN")} 股税后约 ${formatCurrency(net)}。这仍可能覆盖相当长的家庭现金流，但卖出纪律会比当前价位更重要。`;
  }
  if (q.includes("vc") || q.includes("解禁")) {
    return "解禁日前后最大的风险是集中抛压和情绪折价。正式判断需要结合真实公告、成交量和股东结构；在工具里我会把它作为卖出时机风险，而不是改变行权收益公式。";
  }
  if (q.includes("2/3") || q.includes("全部")) {
    return "2/3 方案更像“先锁定财务目标，再保留一部分上涨期权”。全部行权的现金确定性更强，但会减少后续上涨参与度。建议先看税后现金是否已经超过你的最低目标。";
  }
  if (q.includes("时机") || q.includes("最佳")) {
    return "最佳时机不是猜最高点，而是找到能确定执行的窗口。若价格高于目标线且流动性正常，提前锁定通常比等到最后一天更安心。";
  }
  return "这是个好问题。第一版我会优先结合当前股价、汇率、行权股数、税后现金和解禁风险来回答；配置智谱 API key 后可以生成更完整的推理说明。";
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}

async function generateAnalysis() {
  const button = $("#generate-analysis");
  const output = $("#ai-output");
  button.disabled = true;
  button.textContent = "AI 分析中...";
  output.className = "ai-output";
  output.textContent = "正在分析当前参数...";
  try {
    const result = await postJson("/api/quhe/analyze", latestMetrics);
    output.innerHTML = result.html;
  } catch (error) {
    output.innerHTML = localAnalysis();
    toast(`${error.message}，已显示本地演示分析`);
  } finally {
    button.disabled = false;
    button.textContent = "重新生成 AI 分析";
  }
}

function appendChat(role, html) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${role}`;
  bubble.innerHTML = `<b>${role === "user" ? "你" : "AI 助手"}</b>${html}`;
  $("#chat-history").appendChild(bubble);
  $("#chat-history").scrollTop = $("#chat-history").scrollHeight;
  return bubble;
}

async function sendChat(question) {
  const cleaned = question.trim();
  if (!cleaned) return;
  appendChat("user", escapeHtml(cleaned));
  const pending = appendChat("ai", "正在分析...");
  try {
    const result = await postJson("/api/quhe/chat", { question: cleaned, metrics: latestMetrics });
    pending.innerHTML = `<b>AI 助手</b>${result.html}`;
  } catch (error) {
    pending.innerHTML = `<b>AI 助手</b>${escapeHtml(localReply(cleaned))}`;
  }
  $("#chat-history").scrollTop = $("#chat-history").scrollHeight;
}

function openSettings() {
  $("#settings-modal").classList.add("open");
  $("#modal-backdrop").classList.add("open");
  $("#settings-modal").setAttribute("aria-hidden", "false");
}

function closeSettings() {
  $("#settings-modal").classList.remove("open");
  $("#modal-backdrop").classList.remove("open");
  $("#settings-modal").setAttribute("aria-hidden", "true");
}

function renderAiSettings(settings) {
  if (!settings) return;
  $("#zhipu-text-model").value = settings.textModel || "glm-4.7-flash";
  $("#api-key-hint").textContent = settings.configured
    ? `已保存 ${settings.keyHint}，输入新 Key 可覆盖`
    : "尚未配置";
  const status = $("#ai-status");
  status.className = "connection-pill";
  if (settings.connectionStatus === "connected") {
    status.textContent = "AI 已连接";
    status.classList.add("connected");
  } else if (settings.connectionStatus === "error") {
    status.textContent = "AI 连接失败";
    status.classList.add("error");
  } else {
    status.textContent = settings.configured ? "AI 待测试" : "AI 未配置";
  }
}

async function loadAiSettings() {
  if (location.protocol === "file:") {
    $("#ai-status").textContent = "静态预览";
    return;
  }
  try {
    const response = await fetch("/api/settings/ai");
    const result = await response.json();
    renderAiSettings(result.settings);
  } catch {
    $("#ai-status").textContent = "AI 状态未知";
  }
}

async function saveAiSettings(event) {
  event.preventDefault();
  const button = $("#save-settings");
  const errorBox = $("#settings-error");
  button.disabled = true;
  button.textContent = "测试中...";
  errorBox.classList.remove("show");
  try {
    const response = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: $("#zhipu-api-key").value,
        textModel: $("#zhipu-text-model").value,
        visionModel: "glm-4.6v-flash"
      })
    });
    const result = await response.json();
    renderAiSettings(result.settings);
    if (!response.ok) throw new Error(result.error || "连接失败");
    $("#zhipu-api-key").value = "";
    closeSettings();
    toast(result.message || "智谱 AI 连接成功");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.add("show");
    toast("AI 设置保存失败");
  } finally {
    button.disabled = false;
    button.textContent = "保存并测试连接";
  }
}

$("#price").addEventListener("input", () => {
  calculate();
  renderChart(currentPeriod);
});
$("#rate").addEventListener("input", calculate);
$("#shares-slider").addEventListener("input", (event) => updateShares(event.target.value));
$("#refresh-price").addEventListener("click", (event) => {
  event.target.textContent = "...";
  setTimeout(() => {
    const price = (18.5 + Math.random() * 3).toFixed(2);
    $("#price").value = price;
    event.target.textContent = "刷新";
    calculate();
    renderChart(currentPeriod);
    toast(`股价已更新：${price} HKD（模拟数据）`);
  }, 600);
});
$("#refresh-rate").addEventListener("click", (event) => {
  event.target.textContent = "...";
  setTimeout(() => {
    const rate = (0.917 + Math.random() * 0.009).toFixed(4);
    $("#rate").value = rate;
    event.target.textContent = "刷新";
    calculate();
    toast(`汇率已更新：1 HKD = ${rate} CNY（模拟数据）`);
  }, 500);
});
$$("#period-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    $$("#period-tabs button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderChart(button.dataset.period);
  });
});
$$("#quick-shares button").forEach((button) => {
  button.addEventListener("click", () => {
    $("#shares-slider").value = button.dataset.shares;
    updateShares(button.dataset.shares);
  });
});
$("#generate-analysis").addEventListener("click", generateAnalysis);
$("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat($("#chat-input").value);
  $("#chat-input").value = "";
});
$("#chat-input").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  sendChat($("#chat-input").value);
  $("#chat-input").value = "";
});
$$("#suggested button").forEach((button) => {
  button.addEventListener("click", () => sendChat(button.textContent));
});
$("#open-settings").addEventListener("click", openSettings);
$("#close-settings").addEventListener("click", closeSettings);
$("#modal-backdrop").addEventListener("click", closeSettings);
$("#toggle-key").addEventListener("click", () => {
  const input = $("#zhipu-api-key");
  input.type = input.type === "password" ? "text" : "password";
  $("#toggle-key").textContent = input.type === "password" ? "显示" : "隐藏";
});
$("#settings-form").addEventListener("submit", saveAiSettings);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSettings();
});
window.addEventListener("resize", () => renderChart(currentPeriod));

updateShares(100000);
renderChart("1M");
loadAiSettings();
