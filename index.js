const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const fs = require("fs");
const bodyParser = require("body-parser");
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

// ✅ PATCH：保留原始 body 給 LINE middleware 驗證簽名使用
app.post("/webhook",
  bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf; } }),
  line.middleware(config),
  async (req, res) => {
    const events = req.body.events;
    for (let event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();
        const userId = event.source.userId;

        // 📘 支援語言列表（ISO 639-1 標準）
        const allowedLangs = [
          "af", "am", "ar", "az", "be", "bg", "bn", "bs", "ca", "ceb",
          "co", "cs", "cy", "da", "de", "el", "en", "eo", "es", "et", "eu",
          "fa", "fi", "fr", "fy", "ga", "gd", "gl", "gu", "ha", "haw",
          "he", "hi", "hmn", "hr", "ht", "hu", "hy", "id", "ig", "is",
          "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "ku", "ky",
          "la", "lb", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn",
          "mr", "ms", "mt", "my", "ne", "nl", "no", "ny", "pa", "pl",
          "ps", "pt", "ro", "ru", "rw", "sd", "si", "sk", "sl", "sm",
          "sn", "so", "sq", "sr", "st", "su", "sv", "sw", "ta", "te",
          "tg", "th", "tk", "tl", "tr", "tt", "ug", "uk", "ur", "uz",
          "vi", "xh", "yi", "yo", "zh", "tw", "cn", "zu"
        ];

        const userLangMap = global.userLangMap || (global.userLangMap = {});

        if (text === "/help") {
          const helpMessage = `🤖 使用說明：\n請直接輸入想翻譯的句子，我會幫你翻成預設語言（預設英文）\n\n📌 指令：\n/to 語言代碼 👉 設定翻譯語言，例如 /to ja\n/multi 👉 同時翻譯成多國語言\n/help 👉 查看說明與語言列表\n\n✅ 支援語言代碼：\n${allowedLangs.map(code => `/${code}`).join(" ")}`;
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: helpMessage
          });
          continue;
        }

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

        if (text === "/multi") {
          const targetLangs = ["en", "ja", "ko", "th", "vi", "id", "ml"];
          const results = [];

          for (const lang of targetLangs) {
            try {
              const completion = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                  model: "gpt-3.5-turbo",
                  messages: [
                    {
                      role: "system",
                      content: `你是一個翻譯專家，請將輸入翻譯成 ${lang}`
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
              results.push(`🔸 ${lang}: ${completion.data.choices[0].message.content}`);
            } catch (e) {
              results.push(`❌ ${lang}: 翻譯失敗`);
            }
          }

          await client.replyMessage(event.replyToken, {
            type: "text",
            text: results.join("\n")
          });
          continue;
        }

        if (!userLangMap[userId]) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: "❗ 請先輸入 /to 語言代碼 例如：/to ja 或輸入 /help 查看支援語言"
          });
          continue;
        }

        let targetLang = userLangMap[userId];
        if (targetLang === "tw") targetLang = "zh-TW";
        if (targetLang === "cn") targetLang = "zh-CN";

        try {
          const completion = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
              model: "gpt-3.5-turbo",
              messages: [
                {
                  role: "system",
                  content: `你是一個專業翻譯機器人，請將以下句子翻譯成 ${targetLang}`
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
