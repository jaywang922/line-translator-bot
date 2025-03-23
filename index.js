const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

if (process.env.GOOGLE_CLOUD_KEY) {
  try {
    fs.writeFileSync("google-key.json", process.env.GOOGLE_CLOUD_KEY);
    console.log("✅ google-key.json 已建立");
  } catch (error) {
    console.error("❌ 寫入 google-key.json 失敗:", error.message);
  }
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET || "dummy",
};

const client = new line.Client(config);
const app = express();

const allowedLangs = [
  "en", "ja", "ko", "zh-TW", "zh-CN", "fr", "de", "es", "th", "it", "nl",
  "ru", "id", "vi", "ar", "hi", "pt", "ms", "tr", "pl", "uk", "sv", "fi", "no",
  "da", "cs", "ro", "hu", "he", "bg", "hr", "sk", "sl", "et", "lv", "lt"
];
const multiLangs = ["en", "tw", "ja", "ko", "th", "vi", "id"];
const userLangMap = {};
const userNotifiedMap = {};

const safeReply = async (token, message) => {
  try {
    if (!token || typeof token !== "string" || token.length !== 32) {
      console.warn("⚠️ 無效的 replyToken，略過回覆");
      return;
    }
    const safeText = typeof message === "string" ? message.trim().slice(0, 4000) : "";
    if (!safeText) {
      console.warn("⚠️ 無回覆內容或格式錯誤，略過回覆");
      return;
    }
    await client.replyMessage(token, {
      type: "text",
      text: safeText,
    });
  } catch (err) {
    console.error("❌ 回覆錯誤:", err.response?.data || err.message);
  }
};

app.post("/webhook", line.middleware(config), express.json(), async (req, res) => {
  const events = req.body.events || [];

  for (let event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    const [cmd, ...msgParts] = text.split(" ");
    const langFromCmd = cmd.startsWith("/") ? cmd.slice(1) : null;
    const msg = msgParts.join(" ").trim();

    if (text === "/help") {
      return safeReply(replyToken, `🤖 使用說明：\n1️⃣ 輸入「/語言代碼 翻譯內容」，例如：/ja 今天天氣真好\n2️⃣ 或先輸入「/語言代碼」設定，再單獨輸入文字自動翻譯\n3️⃣ 若要一次翻成多國語言，請使用 /multi 例如：/multi 我肚子餓了\n✅ 支援語言代碼：\n${allowedLangs.map(l => '/' + l).join(' ')}`);
    }

    if (allowedLangs.includes(langFromCmd)) {
      if (msg) {
        userLangMap[userId] = langFromCmd;
      } else {
        return safeReply(replyToken, "❗ 請輸入正確的翻譯內容，例如：/ja 你好 或輸入 /help 查看說明");
      }
    }

    if (text.startsWith("/multi ")) {
      const input = text.replace("/multi", "").trim();
      if (!input) return;

      const results = await Promise.all(multiLangs.map(async (lang) => {
        try {
          const completion = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: `請翻譯為 ${lang}` },
              { role: "user", content: input },
            ],
          }, {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          });
          return `🔸 ${lang}: ${completion.data.choices[0].message.content}`;
        } catch {
          return `❌ ${lang}: 失敗`;
        }
      }));
      return safeReply(replyToken, results.join("\n"));
    }

    const targetLangRaw = userLangMap[userId];
    if (!targetLangRaw) {
      if (!userNotifiedMap[userId]) {
        userNotifiedMap[userId] = true;
        await safeReply(replyToken, "👋 請先輸入 /語言代碼 或 /help 查看用法，例如：/ja 你好");
      }
      continue;
    }

    let targetLang = targetLangRaw;
    if (targetLang === "tw") targetLang = "zh-TW";
    if (targetLang === "cn") targetLang = "zh-CN";

    const prompt = msg || text;
    if (!prompt || prompt.startsWith("/")) continue;

    try {
      const completion = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: `請翻譯為 ${targetLang}` },
          { role: "user", content: prompt },
        ],
      }, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });

      const translated = completion.data.choices[0].message.content;
      const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(translated)}&tl=${targetLang}`;

      await safeReply(replyToken, `${translated}\n🔊 ${audioUrl}`);
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
