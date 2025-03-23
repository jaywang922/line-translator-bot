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
        const userNotifiedMap = global.userNotifiedMap || (global.userNotifiedMap = {});

        if (text === "/help") {
          const helpMessage = `🤖 使用說明：
請直接輸入您想翻譯的句子，例如：「我想吃雞蛋」
若尚未設定語言，機器人會提示您輸入 /to 指令來設定。

📌 指令說明：
/to 語言代碼 👉 設定預設翻譯語言，例如 /to ja（翻成日文）
/multi 👉 同時翻譯成多國語言
/debug 👉 查看目前設定語言
/help 👉 查看使用說明與所有語言代碼

✅ 支援語言代碼（可用於 /to）：
${allowedLangs.map(code => `/${code}`).join(" ")}`;
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: helpMessage
          });
          continue;
        }

        if (text === "/debug") {
          const lang = userLangMap[userId] || "尚未設定";
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: `🔧 目前語言設定為：${lang}`
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

        if (text.startsWith("/multi ")) {
          const content = text.replace("/multi", "").trim();
          const targetLangs = ["en", "tw", "ja", "ko", "th", "vi", "id"];
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
                      content: `你是一位語言專家，請將以下內容完整翻譯成「${lang}語」，輸出內容請完全使用 ${lang} 語言，不要包含其他語言。`
                    },
                    {
                      role: "user",
                      content
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
          if (!userNotifiedMap[userId]) {
            userNotifiedMap[userId] = true;
            await client.replyMessage(event.replyToken, {
              type: "text",
              text: "👋 歡迎使用翻譯機器人，請先輸入 /to 語言代碼，例如：/to en 或輸入 /help 查看使用方式"
            });
          }
          console.log(`🟡 使用者 ${userId} 尚未設定語言，略過回覆`);
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

          const translated = completion.data.choices[0].message.content.slice(0, 1800);
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
