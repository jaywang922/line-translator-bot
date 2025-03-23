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
app.use(express.json());

const allowedLangs = [
  "en", "ja", "ko", "zh-TW", "zh-CN", "fr", "de", "es", "th", "it", "nl",
  "ru", "id", "vi", "ar", "hi", "pt", "ms", "tr", "pl", "uk", "sv", "fi", "no",
  "da", "cs", "ro", "hu", "he", "bg", "hr", "sk", "sl", "et", "lv", "lt"
];
const multiLangs = ["en", "tw", "ja", "ko", "th", "vi", "id"];
const userLangMap = {};
const userNotifiedMap = {};

app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events || [];

  for (let event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;

    const text = event.message.text.trim();
    const userId = event.source.userId;
    const reply = (msg) => client.replyMessage(event.replyToken, { type: "text", text: msg });

    if (text === "/help") {
      return reply(`🤖 使用說明：\n請輸入「/to 語言代碼」設定翻譯語言，例如：/to ja\n然後直接輸入想翻譯的句子即可，例如：「我想吃雞蛋」\n/multi 可翻譯多國語言\n✅ 支援語言代碼：\n${allowedLangs.map(l => '/' + l).join(' ')}`);
    }

    if (text.startsWith("/to ")) {
      const lang = text.split(" ")[1];
      if (allowedLangs.includes(lang)) {
        userLangMap[userId] = lang;
        return reply(`✅ 已設定語言為：${lang}`);
      } else {
        return reply("❗ 語言代碼錯誤，請輸入 /help 查看支援語言");
      }
    }

    if (text.startsWith("/multi ")) {
      const input = text.replace("/multi", "").trim();
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
      return reply(results.join("\n"));
    }

    if (!userLangMap[userId]) {
      if (!userNotifiedMap[userId]) {
        userNotifiedMap[userId] = true;
        await reply("👋 請先輸入 /to 語言代碼，例如：/to ja 或輸入 /help 查看用法");
      }
      continue;
    }

    let targetLang = userLangMap[userId];
    if (targetLang === "tw") targetLang = "zh-TW";
    if (targetLang === "cn") targetLang = "zh-CN";

    try {
      const completion = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: `請翻譯為 ${targetLang}` },
          { role: "user", content: text },
        ],
      }, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });

      const translated = completion.data.choices[0].message.content;
      const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(translated)}&tl=${targetLang}`;

      await reply(`${translated}\n🔊 ${audioUrl}`);
    } catch (err) {
      console.error("❌ 翻譯錯誤:", err.response?.data || err.message);
      await reply("⚠️ 翻譯失敗，請稍後再試");
    }
  }
  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("✅ Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("🚀 Bot is running on port", port));
