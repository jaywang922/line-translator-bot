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

const userLangMap = {};

const safeReply = async (token, message) => {
  try {
    if (!token || typeof token !== "string" || token.length !== 32) return;
    const safeText = typeof message === "string" ? message.trim().slice(0, 4000) : "";
    if (!safeText) return;
    console.log("⚠️ 傳送訊息:", safeText);
    await client.replyMessage(token, { type: "text", text: safeText });
  } catch (err) {
    console.error("❌ 回覆錯誤:", err.response?.data || err.message);
  }
};

app.post("/webhook", line.middleware(config), express.json(), async (req, res) => {
  const events = req.body.events || [];

  for (const event of events) {
    if (event.type !== "message" || !event.message || event.message.type !== "text") continue;

    const text = event.message.text?.trim();
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    if (!text) continue;

    if (text === "/help") {
      return safeReply(replyToken, `🧭 使用方式：\n1️⃣ 輸入 /語言代碼 要翻譯的內容\n例如：/ja 今天天氣很好\n2️⃣ 或先輸入 /語言代碼，再單獨輸入文字即可\n✅ 支援語言：${allowedLangs.map(l => '/' + l).join(' ')}`);
    }

    const [cmd, ...rest] = text.split(" ");
    const langCode = cmd.startsWith("/") ? cmd.slice(1) : null;
    const message = rest.join(" ").trim();

    if (allowedLangs.includes(langCode)) {
      if (!message) {
        userLangMap[userId] = langCode;
        return safeReply(replyToken, `✅ 已設定翻譯語言為: ${langCode}，請輸入要翻譯的文字`);
      } else {
        userLangMap[userId] = langCode;
      }
    }

    const currentLang = userLangMap[userId];
    const prompt = message || text;

    if (!currentLang || !prompt || prompt.startsWith("/")) return;

    try {
      const res = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: `請將以下句子翻譯為 ${currentLang}` },
          { role: "user", content: prompt },
        ],
      }, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });

      const replyText = res.data.choices[0].message.content;
      await safeReply(replyToken, replyText);
    } catch (err) {
      console.error("❌ 翻譯錯誤:", err.response?.data || err.message);
      await safeReply(replyToken, "⚠️ 翻譯失敗，請稍後再試");
    }
  }
  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("✅ Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("🚀 Bot is running on port", port));
