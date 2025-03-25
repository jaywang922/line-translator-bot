const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
require("dotenv").config();

// 配置管理
const CONFIG = {
  LINE: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  },
  OPENAI: {
    apiKey: process.env.OPENAI_API_KEY,
    maxTokens: 150,
    model: "gpt-3.5-turbo",
  },
  APP: {
    port: process.env.PORT || 8080,
    maxTranslationLength: 1000,
    sessionTimeout: 60, // 分钟
  }
};

// 语言配置
const LANGUAGE_CONFIG = {
  allowedLangs: [
    "en", "ja", "ko", "zh-TW", "zh-CN", "fr", "de", 
    "es", "th", "it", "nl", "ru", "id", "vi", "pt", "ms"
  ],
  langNameMap: {
    "en": "英文", "ja": "日文", "ko": "韩文", 
    "zh-TW": "繁体中文", "zh-CN": "简体中文",
    "fr": "法文", "de": "德文", "es": "西班牙文", 
    "th": "泰文", "it": "意大利文", "nl": "荷兰文", 
    "ru": "俄文", "id": "印尼文", "vi": "越南文", 
    "pt": "葡萄牙文", "ms": "马来文"
  }
};

// 安全性增强的错误处理函数
function handleError(error, context = '未知操作') {
  const errorDetails = {
    context,
    timestamp: new Date().toISOString(),
    errorType: error.name,
    message: error.message,
    stack: error.stack
  };

  console.error(`❌ 错误 - ${context}:`, errorDetails);
  
  return {
    success: false,
    message: `操作失败：${context}`,
    details: errorDetails
  };
}

// 验证 OpenAI API Key
function validateOpenAIKey() {
  if (!CONFIG.OPENAI.apiKey) {
    throw new Error('未配置 OpenAI API Key');
  }
}

// 高级翻译函数，增加重试和错误处理
async function translateText(text, targetLang, retries = 2) {
  validateOpenAIKey();

  // 输入验证
  if (!text || text.length > CONFIG.APP.maxTranslationLength) {
    throw new Error('翻译文本长度不合法');
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions", 
      {
        model: CONFIG.OPENAI.model,
        max_tokens: CONFIG.OPENAI.maxTokens,
        messages: [
          { 
            role: "system", 
            content: `请将用户的句子翻译为「${LANGUAGE_CONFIG.langNameMap[targetLang]}」的自然用法，并且只回复翻译内容，不加注解。` 
          },
          { role: "user", content: text }
        ]
      }, 
      {
        headers: { 
          "Authorization": `Bearer ${CONFIG.OPENAI.apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 10000 // 10秒超时
      }
    );

    const translatedText = response.data.choices[0].message.content.trim();
    return translatedText || "翻译失败，请重试";

  } catch (error) {
    if (retries > 0) {
      console.warn(`翻译重试剩余次数: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
      return translateText(text, targetLang, retries - 1);
    }
    throw handleError(error, '翻译请求');
  }
}

// 安全回复函数
const safeReply = async (client, token, message) => {
  try {
    const safeText = (typeof message === 'string' ? message : JSON.stringify(message))
      .trim()
      .slice(0, 4000);

    if (!safeText) {
      console.warn("无效消息");
      return;
    }

    await client.replyMessage(token, { type: "text", text: safeText });
  } catch (error) {
    handleError(error, 'LINE消息回复');
  }
};

// 主应用程序设置
function createApp() {
  const app = express();

  // 重要：信任代理配置
  app.set('trust proxy', true);

  // 安全中间件
  app.use(helmet());

  // 速率限制
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 限制每个IP 100请求
    message: '请求过于频繁，请稍后再试',
    standardHeaders: true, // 返回 `RateLimit-*` 头
    legacyHeaders: false // 禁用 `X-RateLimit-*` 头
  });
  app.use(limiter);

  // 配置 LINE
  const lineConfig = {
    channelAccessToken: CONFIG.LINE.channelAccessToken,
    channelSecret: CONFIG.LINE.channelSecret
  };
  const lineClient = new line.Client(lineConfig);

  // 用户会话管理（可以考虑使用 Redis 替代）
  const userSessions = new Map();

  // Webhook 处理逻辑
  app.post("/webhook", line.middleware(lineConfig), express.json(), async (req, res) => {
    try {
      const events = req.body.events || [];
      for (const event of events) {
        // 处理事件的详细逻辑（保留原有的事件处理逻辑）
        const now = Date.now();
        if (now - event.timestamp > 3000) continue;
        if (event.type !== "message" || !event.message || event.message.type !== "text") continue;

        const text = event.message.text?.trim();
        const replyToken = event.replyToken;
        const userId = event.source.userId;

        // 此处应该是您原有的事件处理逻辑
        // 可以参考之前的代码，完成翻译和回复等操作
      }
      res.sendStatus(200);
    } catch (error) {
      handleError(error, 'Webhook处理');
      res.sendStatus(500);
    }
  });

  return app;
}

// 启动服务
function startServer() {
  const app = createApp();

  app.get("/", (_, res) => res.send("✅ 机器人正在运行"));

  app.listen(CONFIG.APP.port, () => {
    console.log(`🚀 服务已启动，端口：${CONFIG.APP.port}`);
  });
}

// 主进程错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

// 启动应用
startServer();