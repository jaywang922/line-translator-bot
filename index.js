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

// 使用 raw body 處理 LINE Webhook 驗證
app.post("/webhook", express.raw({ type: "*/*" }), line.middleware(config), async (req, res) => {
  const events = req.body.events;
  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text;
      const userId = event.source.userId;
      const [cmd, ...msgParts] = text.split(" ");
      const lang = cmd.replace("/", "").trim();

      // 📘 支援語言列表
      const allowedLangs = [
        "en", "ja", "ko", "zh-TW", "zh-CN",
        "fr", "de", "es", "th", "it",
        "nl", "ru", "id", "vi", "ar", "hi"
      ];

      if (cmd === "/help") {
        const helpMessage = `🤖 使用說明：
請輸入「/語言代碼 要翻譯的文字」，例如：
/ja 今天天氣真好

✅ 支援語言指令如下：
${allowedLangs.map(code => `/${code}`).join(" ")}`;
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: helpMessage
        });
        continue;
      }

      if (!allowedLangs.includes(lang)) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "❗ 請輸入正確語言代碼，例如：/ja 你好 或輸入 /help 查看支援語言"
        });
        continue;
      }

      const msg = msgParts.join(" ").trim();
      if (!msg) continue;

      try {
        const completion = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: "你是一個專業翻譯機器人，請將輸入翻譯為 " + lang
              },
              {
                role: "user",
                content: msg
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
        try {
          const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(translated)}&tl=${lang}`;

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `${translated}\n🔊 ${audioUrl}`
          });
        } catch (err) {
          console.error("❌ GPT or TTS 錯誤:", err.response?.data || err.message);
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "⚠️ 翻譯成功，但語音播放失敗，請稍後再試！"
          });
        }
      } catch (err) {
        console.error("❌ GPT or TTS 錯誤:", err.message);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "⚠️ 翻譯失敗，請稍後再試！"
        });
      }
    }
  }
  res.sendStatus(200);
});

// 保留 GET / 測試用
app.get("/", (req, res) => {
  res.send("✅ Bot is running");
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("🚀 Bot is running on port", port);
});
