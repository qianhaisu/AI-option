# 群核期权助手

群核科技 `00068.HK` 期权行权决策辅助工具。第一版包含股价与汇率参数、行权数量测算、个税估算、税后现金指标、AI 决策分析和问答。

## 本地运行

```bash
npm install
npm start
```

浏览器打开 `http://127.0.0.1:4173`。

## AI 配置

本地可以在页面右上角 **AI 设置** 中保存智谱 API Key。也可以使用环境变量：

```bash
export AI_PROVIDER="zhipu"
export ZHIPU_API_KEY="你的智谱 API Key"
export ZHIPU_TEXT_MODEL="glm-4.7-flash"
export ZHIPU_VISION_MODEL="glm-4.6v-flash"
npm start
```

不要把 API Key 写进前端、提交到版本库或发送到聊天中。

## Vercel 部署

建议流程：

1. 推送代码到 GitHub 仓库 `qianhaisu/AI-qunhe`。
2. 在 Vercel 新建项目，导入这个 GitHub 仓库。
3. 在 Vercel 项目的 Environment Variables 添加：
   - `AI_PROVIDER=zhipu`
   - `ZHIPU_API_KEY=你的智谱 API Key`
   - `ZHIPU_TEXT_MODEL=glm-4.7-flash`
   - `ZHIPU_VISION_MODEL=glm-4.6v-flash`
4. 部署完成后访问 Vercel 分配的域名。

## 校验

```bash
npm run check
```

## 说明

本工具用于个人决策辅助，税费与市场分析均为估算，不构成投资、法律或税务建议。
