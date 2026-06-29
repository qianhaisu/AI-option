import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "prototype");
const dataFile = path.join(root, "data", "db.json");
const secretsFile = path.join(root, "data", "secrets.json");
const uploadDir = process.env.VERCEL ? path.join("/tmp", "uploads") : path.join(root, "data", "uploads");
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 25 * 1024 * 1024;
let aiConfig = {
  provider: process.env.AI_PROVIDER || "zhipu",
  apiKey: process.env.ZHIPU_API_KEY || process.env.OPENAI_API_KEY || "",
  textModel: process.env.ZHIPU_TEXT_MODEL || process.env.OPENAI_MODEL || "glm-4.7-flash",
  visionModel: process.env.ZHIPU_VISION_MODEL || "glm-4.6v-flash",
  connectionStatus: "untested",
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

const allowedUploads = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp"
]);

async function readDb() {
  return JSON.parse(await fs.readFile(dataFile, "utf8"));
}

async function writeDb(db) {
  const temporary = `${dataFile}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(db, null, 2)}\n`);
  await fs.rename(temporary, dataFile);
}

async function loadAiConfig() {
  try {
    const stored = JSON.parse(await fs.readFile(secretsFile, "utf8"));
    aiConfig = {
      ...aiConfig,
      ...stored,
      apiKey: stored.apiKey || aiConfig.apiKey
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取 AI 配置失败", error);
  }
}

async function saveAiConfig() {
  await fs.writeFile(secretsFile, `${JSON.stringify(aiConfig, null, 2)}\n`, {
    mode: 0o600
  });
  await fs.chmod(secretsFile, 0o600);
}

function publicAiConfig() {
  return {
    provider: aiConfig.provider,
    configured: Boolean(aiConfig.apiKey),
    keyHint: aiConfig.apiKey ? `••••${aiConfig.apiKey.slice(-4)}` : "",
    textModel: aiConfig.textModel,
    visionModel: aiConfig.visionModel,
    connectionStatus: aiConfig.connectionStatus,
    lastTestedAt: aiConfig.lastTestedAt,
    lastError: aiConfig.lastError
  };
}

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
    if (size > maxBodyBytes) throw new Error("请求内容超过 25MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function safeFilename(filename) {
  const extension = path.extname(filename).toLowerCase();
  return `${Date.now()}-${crypto.randomUUID()}${extension}`;
}

function memberName(db, memberId) {
  return db.members.find((member) => member.id === memberId)?.name || "待确认";
}

function calculateAssessment(db) {
  const confirmed = db.policies.filter((policy) => policy.status === "confirmed");
  const hasCoverage = (memberId, riskType) =>
    confirmed.some((policy) => policy.memberId === memberId && policy.riskType === riskType);

  const findings = [];
  const spouse = db.members.find((member) => member.name === "张永腾");
  const child = db.members.find((member) => member.name === "张小年");
  const user = db.members.find((member) => member.name === "苏静");

  const medicalGaps = [spouse, child].filter(
    (member) => member && !hasCoverage(member.id, "medical")
  );
  if (medicalGaps.length) {
    findings.push({
      id: "medical-family-gap",
      priority: "P1",
      level: "最高",
      status: "confirmed",
      title: `补齐${medicalGaps.map((member) => member.name).join("和")}的商业医疗保障`,
      reason: "家庭目标将医疗风险列为第一优先，当前档案未发现这些成员已确认的商业医疗保障。",
      impact: "较大医疗费用可能直接占用家庭现金流。",
      action: "先确认是否存在未录入的单位补充医疗或商业医疗保单。",
      evidence: [
        "家庭保障目标 v1：医疗优先",
        `已确认保单中有 ${medicalGaps.length} 位成员缺少商业医疗`,
        "年度保费上限：5 万元"
      ]
    });
  }

  const deathGaps = [user, spouse].filter(
    (member) => member && !hasCoverage(member.id, "death")
  );
  if (deathGaps.length) {
    findings.push({
      id: "death-responsibility-gap",
      priority: "P1",
      level: "高",
      status: "confirmed",
      title: "为两位主要收入者建立责任期身故保障",
      reason: "家庭承担房贷和育儿责任，当前档案未发现已确认的责任期寿险。",
      impact: "主要收入者发生极端风险时，房贷和育儿责任缺少资金承接。",
      action: "在医疗保障确认后，评估与责任期限相匹配的定期保障。",
      evidence: ["家庭责任：房贷与育儿", "两位主要收入者均未发现已确认身故保障"]
    });
  }

  const incompleteLongTerm = db.policies.filter(
    (policy) =>
      policy.coveragePeriod?.includes("长期") &&
      (policy.annualPremium == null || policy.status !== "confirmed")
  );
  if (incompleteLongTerm.length) {
    findings.push({
      id: "liquidity-needs-data",
      priority: "P2",
      level: "待确认",
      status: "needs_data",
      title: "长期锁定资金占比是否过高，暂时无法判断",
      reason: "缺少长期保单的年度保费、剩余缴费期或现金价值信息。",
      impact: "资料不完整时无法可靠判断家庭流动性压力。",
      action: "补充长期保单信息后重新计算。",
      evidence: incompleteLongTerm.map((policy) => `${policy.name}：资料待确认`)
    });
  }

  const confirmedCount = confirmed.length;
  const completeness = Math.round(
    (confirmedCount / Math.max(db.policies.length, 1)) * 100
  );
  const score = Math.max(35, 100 - medicalGaps.length * 12 - deathGaps.length * 8);

  return {
    generatedAt: new Date().toISOString(),
    score,
    dataCompleteness: completeness,
    findings
  };
}

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    insurer: { type: ["string", "null"] },
    productName: { type: ["string", "null"] },
    policyNumber: { type: ["string", "null"] },
    policyholder: { type: ["string", "null"] },
    insuredPerson: { type: ["string", "null"] },
    riskType: {
      type: "string",
      enum: ["medical", "critical_illness", "accident", "death", "pension", "other", "unknown"]
    },
    coverageMethod: { type: ["string", "null"] },
    coverageAmount: { type: ["number", "null"] },
    coveragePeriod: { type: ["string", "null"] },
    annualPremium: { type: ["number", "null"] },
    nextPaymentDate: { type: ["string", "null"] },
    summary: { type: "string" },
    uncertainties: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "insurer",
    "productName",
    "policyNumber",
    "policyholder",
    "insuredPerson",
    "riskType",
    "coverageMethod",
    "coverageAmount",
    "coveragePeriod",
    "annualPremium",
    "nextPaymentDate",
    "summary",
    "uncertainties"
  ]
};

async function extractPdfText(bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages = [];
  const pageLimit = Math.min(pdf.numPages, 80);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ").trim();
    if (text) pages.push(`第 ${pageNumber} 页\n${text}`);
  }
  return pages.join("\n\n").slice(0, 120000);
}

function parseJsonResponse(content) {
  const cleaned = String(content)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function extractionPrompt(policyName) {
  return `你是家庭保险保单信息提取助手。请从用户提供的保单材料中忠实提取结构化信息。

用户暂定保单名称：${policyName}

要求：
1. 只依据材料，不猜测。
2. 无法确认的字段使用 null，并写入 uncertainties。
3. 日期统一为 YYYY-MM-DD。
4. riskType 只能是 medical、critical_illness、accident、death、pension、other、unknown。
5. coverageAmount 和 annualPremium 使用人民币数字；无法确认币种或金额时用 null。
6. 只输出 JSON，不要 Markdown。

JSON 必须包含以下全部字段：
${JSON.stringify(extractionSchema, null, 2)}`;
}

async function callZhipu(model, messages) {
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${aiConfig.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    if (response.ok) {
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (!content) throw new Error("GLM 没有返回可解析内容");
      return parseJsonResponse(content);
    }

    const error = await response.text();
    lastError = new Error(`AI 识别失败：${response.status} ${error.slice(0, 300)}`);
    if (response.status !== 429 || attempt === 3) throw lastError;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (2 ** attempt)));
  }
  throw lastError;
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
  return true;
}

async function callZhipuText(model, messages) {
  if (aiConfig.provider !== "zhipu" || !aiConfig.apiKey) {
    throw new Error("AI 尚未连接，请先在 AI 设置中保存智谱 API Key");
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
    `行权价：0.025 CNY/股`,
    `税前所得估算：${Math.round(gross).toLocaleString("zh-CN")} CNY`,
    `个税估算：${Math.round(tax).toLocaleString("zh-CN")} CNY，使用一次性股票期权收入分月摊计的简化估算`,
    `税后到手估算：${Math.round(net).toLocaleString("zh-CN")} CNY`,
    `相当于月盈余 23,000 CNY 的 ${years.toFixed(1)} 年`
  ].join("\n");
}

async function analyzeQunhe(req, res) {
  if (!aiConfig.apiKey) {
    return json(res, 400, { error: "AI 尚未连接，请先在 AI 设置中保存智谱 API Key" });
  }
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
  if (!aiConfig.apiKey) {
    return json(res, 400, { error: "AI 尚未连接，请先在 AI 设置中保存智谱 API Key" });
  }
  const body = await readJson(req);
  const question = String(body.question || "").trim();
  if (!question) return json(res, 400, { error: "问题不能为空" });
  const content = await callZhipuText(aiConfig.textModel, [
    {
      role: "system",
      content: "你是群核期权助手。回答要结合用户当前参数，优先说明估算逻辑、风险和行动边界。不要声称知道实时行情或最新公告；如果问题需要外部事实，明确说需要用户补充或接入数据源。中文回答，控制在 180 字以内。"
    },
    {
      role: "user",
      content: `当前参数：\n${quheContext(body.metrics)}\n\n用户问题：${question}`
    }
  ]);
  return json(res, 200, { html: textToHtml(content), text: content });
}

async function extractPolicyWithAI(policyName, files) {
  if (aiConfig.provider !== "zhipu" || !aiConfig.apiKey || !files.length) return null;

  const pdfTexts = [];
  const images = [];
  for (const file of files) {
    if (file.type === "application/pdf") {
      const text = await extractPdfText(Buffer.from(file.base64, "base64"));
      if (text) pdfTexts.push(`文件：${file.originalName}\n${text}`);
    } else if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      images.push(file);
    }
  }

  const prompt = extractionPrompt(policyName);
  if (images.length) {
    const content = [
      {
        type: "text",
        text: `${prompt}\n\n${pdfTexts.length ? `PDF 文本：\n${pdfTexts.join("\n\n")}` : ""}`
      },
      ...images.map((file) => ({
        type: "image_url",
        image_url: {
          url: `data:${file.type};base64,${file.base64}`
        }
      }))
    ];
    return callZhipu(aiConfig.visionModel, [{ role: "user", content }]);
  }

  if (pdfTexts.length) {
    return callZhipu(aiConfig.textModel, [
      {
        role: "user",
        content: `${prompt}\n\n保单 PDF 文本：\n${pdfTexts.join("\n\n")}`
      }
    ]);
  }

  throw new Error("HEIC/HEIF 暂时只能保存，AI 识别请先转换为 JPG 或 PNG");
}

async function createPolicy(req, res) {
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  if (!name) return json(res, 400, { error: "保单名称不能为空" });

  const db = await readDb();
  const member = body.memberId
    ? db.members.find((item) => item.id === body.memberId)
    : null;
  if (body.memberId && !member) return json(res, 400, { error: "被保障人不存在" });

  const inputFiles = Array.isArray(body.files) ? body.files : [];
  const files = [];
  await fs.mkdir(uploadDir, { recursive: true });

  for (const file of inputFiles) {
    if (!allowedUploads.has(file.type)) {
      return json(res, 400, { error: `不支持的文件格式：${file.name}` });
    }
    const base64 = String(file.data || "").split(",").pop();
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length) return json(res, 400, { error: `文件为空：${file.name}` });
    const storedName = safeFilename(file.name);
    await fs.writeFile(path.join(uploadDir, storedName), bytes);
    files.push({
      id: crypto.randomUUID(),
      originalName: file.name,
      storedName,
      type: file.type,
      size: bytes.length,
      base64
    });
  }

  let extraction = null;
  let aiError = null;
  try {
    extraction = await extractPolicyWithAI(name, files);
  } catch (error) {
    aiError = error.message;
  }

  const policy = {
    id: `policy-${crypto.randomUUID()}`,
    name,
    memberId: member?.id || null,
    riskType: extraction?.riskType || "unknown",
    coverageMethod: extraction?.coverageMethod || null,
    coverageAmount: extraction?.coverageAmount || null,
    coveragePeriod: extraction?.coveragePeriod || null,
    annualPremium: extraction?.annualPremium || null,
    nextPaymentDate: extraction?.nextPaymentDate || null,
    status: "needs_confirmation",
    source: files.length ? "file" : "manual",
    files: files.map(({ base64, ...metadata }) => metadata),
    extraction,
    aiError,
    createdAt: new Date().toISOString()
  };

  db.policies.unshift(policy);
  db.events.unshift({
    id: crypto.randomUUID(),
    type: "policy_created",
    policyId: policy.id,
    at: new Date().toISOString()
  });
  await writeDb(db);

  json(res, 201, {
    policy: { ...policy, memberName: memberName(db, policy.memberId) },
    aiEnabled: aiConfig.connectionStatus === "connected",
    aiProvider: aiConfig.provider,
    message: extraction
      ? "保单已建档，AI 提取结果等待确认"
      : files.length
        ? "保单已建档；AI 尚未启用或识别未完成，资料等待补充"
        : "保单已建档，资料等待补充"
  });
}

async function updateReminder(req, res, id) {
  const body = await readJson(req);
  const db = await readDb();
  const reminder = db.reminders.find((item) => item.id === id);
  if (!reminder) return json(res, 404, { error: "提醒不存在" });
  reminder.status = body.status === "completed" ? "completed" : "pending";
  reminder.updatedAt = new Date().toISOString();
  await writeDb(db);
  json(res, 200, { reminder });
}

async function deletePolicy(res, id) {
  const db = await readDb();
  const index = db.policies.findIndex((policy) => policy.id === id);
  if (index === -1) return json(res, 404, { error: "保单不存在" });
  const [policy] = db.policies.splice(index, 1);
  for (const file of policy.files || []) {
    await fs.rm(path.join(uploadDir, file.storedName), { force: true });
  }
  db.events.unshift({
    id: crypto.randomUUID(),
    type: "policy_deleted",
    policyId: id,
    at: new Date().toISOString()
  });
  await writeDb(db);
  json(res, 200, { deleted: true });
}

async function analyzePolicy(res, id) {
  const db = await readDb();
  const policy = db.policies.find((item) => item.id === id);
  if (!policy) return json(res, 404, { error: "保单不存在" });
  if (!policy.files?.length) return json(res, 400, { error: "这份保单还没有上传文件" });
  if (aiConfig.connectionStatus !== "connected") {
    return json(res, 400, { error: "AI 尚未连接，请先在 AI 设置中测试连接" });
  }

  const files = await Promise.all(policy.files.map(async (file) => ({
    ...file,
    base64: (await fs.readFile(path.join(uploadDir, file.storedName))).toString("base64")
  })));

  try {
    const extraction = await extractPolicyWithAI(policy.name, files);
    policy.extraction = extraction;
    policy.aiError = null;
    policy.status = "needs_confirmation";
    policy.riskType = extraction.riskType || policy.riskType;
    policy.coverageMethod = extraction.coverageMethod;
    policy.coverageAmount = extraction.coverageAmount;
    policy.coveragePeriod = extraction.coveragePeriod;
    policy.annualPremium = extraction.annualPremium;
    policy.nextPaymentDate = extraction.nextPaymentDate;
    policy.analyzedAt = new Date().toISOString();
    await writeDb(db);
    return json(res, 200, {
      policy: { ...policy, memberName: memberName(db, policy.memberId) },
      message: "AI 识别完成，请确认提取结果"
    });
  } catch (error) {
    policy.aiError = error.message;
    policy.analyzedAt = new Date().toISOString();
    await writeDb(db);
    return json(res, 502, {
      policy: { ...policy, memberName: memberName(db, policy.memberId) },
      error: error.message
    });
  }
}

async function confirmPolicy(req, res, id) {
  const body = await readJson(req);
  const db = await readDb();
  const policy = db.policies.find((item) => item.id === id);
  if (!policy) return json(res, 404, { error: "保单不存在" });

  const allowedRiskTypes = new Set([
    "medical", "critical_illness", "accident", "death", "pension", "other", "unknown"
  ]);
  policy.name = String(body.name || policy.name).trim();
  policy.memberId = body.memberId || policy.memberId;
  policy.riskType = allowedRiskTypes.has(body.riskType) ? body.riskType : "unknown";
  policy.coverageMethod = body.coverageMethod || null;
  policy.coverageAmount = body.coverageAmount === "" || body.coverageAmount == null
    ? null
    : Number(body.coverageAmount);
  policy.coveragePeriod = body.coveragePeriod || null;
  policy.annualPremium = body.annualPremium === "" || body.annualPremium == null
    ? null
    : Number(body.annualPremium);
  policy.nextPaymentDate = body.nextPaymentDate || null;
  policy.status = "confirmed";
  policy.confirmedAt = new Date().toISOString();
  await writeDb(db);

  return json(res, 200, {
    policy: { ...policy, memberName: memberName(db, policy.memberId) },
    assessment: calculateAssessment(db),
    message: "保单信息已确认，家庭保险评估已更新"
  });
}

async function updateAiSettings(req, res) {
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
    await saveAiConfig();
    return json(res, 200, {
      settings: publicAiConfig(),
      message: "智谱 AI 连接成功"
    });
  } catch (error) {
    aiConfig = {
      ...candidate,
      connectionStatus: "error",
      lastTestedAt: new Date().toISOString(),
      lastError: error.message
    };
    await saveAiConfig();
    return json(res, 400, {
      settings: publicAiConfig(),
      error: error.message
    });
  }
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
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      const db = await readDb();
      return json(res, 200, {
        ...db,
        assessment: calculateAssessment(db),
        aiEnabled: Boolean(aiConfig.apiKey),
        aiProvider: aiConfig.provider,
        aiSettings: publicAiConfig()
      });
    }
    if (req.method === "GET" && url.pathname === "/api/assessment") {
      return json(res, 200, calculateAssessment(await readDb()));
    }
    if (req.method === "POST" && url.pathname === "/api/quhe/analyze") {
      return await analyzeQunhe(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/quhe/chat") {
      return await chatQunhe(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/policies") {
      return await createPolicy(req, res);
    }
    const policyMatch = url.pathname.match(/^\/api\/policies\/([^/]+)$/);
    const analyzeMatch = url.pathname.match(/^\/api\/policies\/([^/]+)\/analyze$/);
    if (req.method === "POST" && analyzeMatch) {
      return await analyzePolicy(res, analyzeMatch[1]);
    }
    const confirmMatch = url.pathname.match(/^\/api\/policies\/([^/]+)\/confirm$/);
    if (req.method === "PATCH" && confirmMatch) {
      return await confirmPolicy(req, res, confirmMatch[1]);
    }
    if (req.method === "DELETE" && policyMatch) {
      return await deletePolicy(res, policyMatch[1]);
    }
    const reminderMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
    if (req.method === "PATCH" && reminderMatch) {
      return await updateReminder(req, res, reminderMatch[1]);
    }
    if (url.pathname.startsWith("/api/")) {
      return json(res, 404, { error: "接口不存在" });
    }
    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message || "服务器错误" });
  }
}

await fs.mkdir(uploadDir, { recursive: true });
await loadAiConfig();

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
