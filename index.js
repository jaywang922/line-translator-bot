const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
require("dotenv").config();

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

const allowedLangs = [
  "en", "ja", "ko", "zh-TW", "zh-CN", "fr", "de", "es", "th",
  "it", "nl", "ru", "id", "vi", "pt", "ms"
];

const userSession = {}; // 用來記錄使用者的自動翻譯狀態

const langNameMap = {
  "en": "英文",
  "ja": "日文",
  "ko": "韓文",
  "tw": "繁體中文",
  "cn": "簡體中文",
  "fr": "法文",
  "de": "德文",
  "es": "西班牙文",
  "th": "泰文",
  "it": "義大利文",
  "nl": "荷蘭文",
  "ru": "俄文",
  "id": "印尼文",
  "vi": "越南文",
  "pt": "葡萄牙文",
  "ms": "馬來文"
};

const safeReply = async (token, message) => {
  try {
    if (!token || typeof token !== "string" || token.length < 10 || token.length > 50) return;
    let safeText = typeof message === "string" ? message.trim() : JSON.stringify(message);
    safeText = safeText.slice(0, 4000);
    if (!safeText) return;
    await client.replyMessage(token, { type: "text", text: safeText });
  } catch (err) {
    console.error("❌ 回覆錯誤:", err.response?.data || err.message);
  }
};

app.post("/webhook", line.middleware(config), express.json(), async (req, res) => {
  const events = req.body.events || [];
  for (const event of events) {
    const now = Date.now();
    if (now - event.timestamp > 3000) continue;
    if (event.type !== "message" || !event.message || event.message.type !== "text") continue;

    const text = event.message.text?.trim();
    const replyToken = event.replyToken;
    const userId = event.source.userId;

    if (!text) continue;

    if (text === "/stop") {
      if (userSession[userId]) {
        delete userSession[userId];
        return safeReply(replyToken, "🛑 持續翻譯模式已關閉");
      } else {
        return safeReply(replyToken, "ℹ️ 目前未啟用任何持續翻譯模式");
      }
    }

    if (text.startsWith("/multi")) {
      const match = text.match(/^\/multi\s+([a-zA-Z\-\s,]+)(?:\s+(\d{1,2})min)?$/);
      if (!match) return safeReply(replyToken, `⚠️ 格式錯誤，請使用：/multi 語言1,語言2 [Xmin]\n例如：/multi en,ja 5min`);

      const langs = match[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
      const durationMin = match[2] ? parseInt(match[2]) : null;

      if (langs.length === 0 || langs.length > 4)
        return safeReply(replyToken, "⚠️ 最多只能指定 1～4 種語言");

      const invalids = langs.filter(l => !allowedLangs.includes(l));
      if (invalids.length > 0)
        return safeReply(replyToken, `⚠️ 不支援的語言代碼：${invalids.join(", ")}`);

      if (durationMin && (durationMin < 1 || durationMin > 60))
        return safeReply(replyToken, "⚠️ 時間請設定 1～60 分鐘內");

      userSession[userId] = {
        langs,
        until: durationMin ? Date.now() + durationMin * 60000 : null,
      };

      return safeReply(replyToken, `✅ 已啟用多語言翻譯：${langs.map(l => langNameMap[l]).join("、")}${durationMin ? `（持續 ${durationMin} 分鐘）` : ""}`);
    }

    if (userSession[userId] && (!userSession[userId].until || Date.now() < userSession[userId].until)) {
      const langs = userSession[userId].langs || [userSession[userId].lang];
      for (const lang of langs) {
        try {
          const res = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: `請將使用者的句子翻譯為「${langNameMap[lang]}」的自然用法，並且只回傳翻譯內容，不加註解。` },
              { role: "user", content: text },
            ],
          }, {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          });
          let replyText = res.data.choices[0].message.content;
          replyText = typeof replyText === "string" ? replyText.trim().slice(0, 4000) : JSON.stringify(replyText);
          await client.pushMessage(userId, { type: "text", text: `🌐 ${langNameMap[lang]}：
${replyText}` });
        } catch (err) {
          console.error("❌ 多語翻譯錯誤:", err.response?.data || err.message);
          await safeReply(replyToken, `⚠️ ${lang} 翻譯失敗`);
        }
      }
      continue;
    }

    // 其他既有指令與單語翻譯邏輯保留不變...

    return safeReply(replyToken, `🧭 使用方式說明：

1️⃣ 單句翻譯：
   /語言代碼 要翻譯的內容
   例如：/ja 今天天氣很好

2️⃣ 單一語言持續翻譯：
   /語言代碼 Xmin
   例如：/en 10min 表示接下來 10 分鐘都翻譯為英文

3️⃣ 多語翻譯（最多 4 種）：
   /multi 語言1,語言2,... [Xmin]
   例如：/multi en,ja,ko 5min
   ※ 可用逗號或空白分隔

4️⃣ 停止翻譯模式：
   /stop

✅ 支援語言代碼：
${allowedLangs.map(l => '/' + l).join(' ')}`);
  }
  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("✅ Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("🚀 Bot is running on port", port));
