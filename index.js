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
  channelSecret: process.env.LINE_CHANNEL_SECRET || "dummy"
};

const client = new line.Client(config);
const app = express();
app.use(express.json());

// 預設翻譯語言（可被 /to 指令更改）
const userLangMap = {};

// ✅ PATCH：修正 middleware 驗證錯誤
app.post("/webhook", line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim();
      const userId = event.source.userId;

      // 📘 支援語言列表
      const allowedLangs = [
        "en", "ja", "ko", "zh-TW", "zh-CN",
        "fr", "de", "es", "th", "it",
        "nl", "ru", "id", "vi", "ar", "hi"
      ];

      // 指令：/help
      if (text === "/help") {
        const helpMessage = `🤖 使用說明：\n請直接輸入想翻譯的句子，我會幫你翻成預設語言（預設英文）\n\n📌 指令：\n/to 語言代碼 👉 設定翻譯語言，例如 /to ja\n/help 👉 查看說明與語言列表\n\n✅ 支援語言代碼：\n${allowedLangs.map(code => `/${code}`).join(" ")}`;
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: helpMessage
        });
        continue;
      }

      // 指令：/to ja
      if (text.startsWith("/to ")) {
        const newLang = text.replace("/to", "").trim();
        if (allowedLangs.includes(newLang)) {
          userLangMap[userId] = newLang;
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `✅ 已設定預設翻譯語言為：${newLang}`
          });
        } else {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "❗ 語言代碼不正確，請輸入 /help 查看支援語言"
          });
        }
        continue;
      }

      // 若不是指令，判斷是否有設定語言
      if (!userLangMap[userId]) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "❗ 請先輸入 /to 語言代碼 例如：/to ja 或輸入 /help 查看支援語言"
        });
        continue;
      }

      // 自動翻譯處理
      const targetLang = userLangMap[userId] || "en";

      try {
        const detectLangResp = await axios.post(
          "https://translation.googleapis.com/language/translate/v2/detect",
          { q: text },
          {
            headers: { "Content-Type": "application/json" },
            params: { key: process.env.GOOGLE_TRANSLATE_API_KEY }
          }
        );

        const sourceLang = detectLangResp.data.data.detections[0][0].language;

        const completion = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: `你是一個專業翻譯機器人，請將以下 ${sourceLang} 語言的句子翻譯成 ${targetLang}`
              },
              {
                role: "user",
                content: text
              }
            ]
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            }
          }
        );

        const translated = completion.data.choices[0].message.content;
        const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(translated)}&tl=${targetLang}`;

        await client.replyMessage(event.replyToken, {
          type: "text",
          text: `${translated}\n🔊 ${audioUrl}`
        });
      } catch (err) {
        console.error("❌ 翻譯錯誤:", err.response?.data || err.message);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "⚠️ 翻譯失敗，請稍後再試！"
        });
      }
    }
  }
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("✅ Bot is running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("🚀 Bot is running on port", port);
});