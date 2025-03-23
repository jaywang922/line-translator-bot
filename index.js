const express = require("express");
const line = require("@line/bot-sdk");
const axios = require("axios");
const fs = require("fs");
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
require("dotenv").config();

// ... (其餘程式碼) ...

// 更安全的 Google Cloud 金鑰處理 (範例, 需要根據實際情況調整)
async function setupGoogleCloudKey() {
    if (process.env.GOOGLE_CLOUD_KEY) {
        try {
            await writeFileAsync("google-key.json", process.env.GOOGLE_CLOUD_KEY);
            console.log("✅ google-key.json 已建立");
            return true;
        } catch (error) {
            console.error("❌ 寫入 google-key.json 失敗:", error.message);
            return false;
        }
    }
    return false;
}

async function cleanupGoogleCloudKey() {
     if (process.env.GOOGLE_CLOUD_KEY) {
        try {
            await unlinkAsync("google-key.json");
            console.log("✅ google-key.json 已刪除");
        } catch (error) {
            console.error("❌ 刪除 google-key.json 失敗:", error.message);
        }
    }
}

// ... (其餘程式碼) ...

const allowedLangs = [
  "en", "ja", "ko", "zh-TW", "zh-CN", "fr", "de", "es", "th", "it", "nl",
  "ru", "id", "vi", "ar", "hi", "pt", "ms", "tr", "pl", "uk", "sv", "fi", "no",
  "da", "cs", "ro", "hu", "he", "bg", "hr", "sk", "sl", "et", "lv", "lt"
];
const multiLangs = ["en", "zh-TW", "ja", "ko", "th", "vi", "id"]; // 改成 zh-TW

// ... (其餘程式碼) ...


// 更通用的回覆函式 (範例)
const reply = async (event, message) => {
    try {
        if (!event.replyToken || typeof event.replyToken !== "string" || event.replyToken.length !== 32) {
          console.warn("⚠️ 無效的 replyToken，略過回覆");
          return;
        }

        if (!message) {
            console.warn("⚠️ 無回覆內容，略過回覆");
            return;
        }
        // message 可以是字串或物件
        const messageToSend = typeof message === 'string' ? { type: 'text', text: message } : message;

        await client.replyMessage(event.replyToken, messageToSend);
    } catch (err) {
      console.error("❌ 回覆錯誤:", err.response?.data || err.message, err.stack); // 記錄更詳細的錯誤
    }
};

// 獨立的 OpenAI 翻譯函式 (範例)
async function translateWithOpenAI(text, targetLang) {
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

        return completion.data.choices[0].message.content;
    } catch (err) {
        console.error("❌ OpenAI 翻譯錯誤:", err.response?.data || err.message, err.stack); // 更詳細的錯誤記錄
      throw new Error("翻譯失敗，請稍後再試"); // 拋出錯誤, 讓上層處理
    }
}

app.post("/webhook", line.middleware(config), async (req, res) => {
    const events = req.body.events || [];

    for (let event of events) {
        if (event.type !== "message" || event.message.type !== "text") continue;

        const text = event.message.text.trim();
        const userId = event.source.userId;

        if (text === "/help") {
          const helpMessage = `🤖 使用說明：\n1️⃣ 輸入「/語言代碼 翻譯內容」，例如：/ja 今天天氣真好\n2️⃣ 或先輸入「/語言代碼」設定，再單獨輸入文字自動翻譯\n3️⃣ 若要一次翻成多國語言，請使用 /multi 例如：/multi 我肚子餓了\n✅ 支援語言代碼：\n${allowedLangs.map(l => '/' + l).join(' ')}`;
          await reply(event, helpMessage); // 使用統一的 reply 函式
            continue;
        }
        const [cmd, ...msgParts] = text.split(" ");
        const languageCode = cmd.startsWith("/") ? cmd.slice(1) : null;
        const messageContent = msgParts.join(" ").trim();

        if (allowedLangs.includes(languageCode)) {
            userLangMap[userId] = languageCode;
            if (messageContent) {
               // 直接翻譯，下面有處理
            } else {
                await reply(event, `✅ 已設定語言為：${languageCode}`);
                continue;
            }
        }

        if (text.startsWith("/multi ")) {
            const input = text.replace("/multi", "").trim();
            const results = await Promise.all(multiLangs.map(async (lang) => {
                try {
                  const translatedText = await translateWithOpenAI(input, lang); // 使用獨立的翻譯函式
                    return `🔸 ${lang}: ${translatedText}`;
                } catch {
                    return `❌ ${lang}: 失敗`;
                }
            }));
            await reply(event, results.join("\n"));
            continue;
        }

        let targetLang = userLangMap[userId];
        if (!targetLang) {
            if (!userNotifiedMap[userId]) {
                userNotifiedMap[userId] = true;
                await reply(event, "👋 請先輸入 /語言代碼 或 /help 查看用法，例如：/ja 你好");
            }
            continue;
        }

        // targetLang 不需要特別處理 zh-TW 和 zh-CN, allowedLangs 已經是標準格式

        try {
            const translated = await translateWithOpenAI(messageContent || text, targetLang); // 使用獨立的翻譯函式
            const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(translated)}&tl=${targetLang}`;
            await reply(event, `${translated}\n🔊 ${audioUrl}`);
        } catch (error) {
          // translateWithOpenAI 已經拋出錯誤, 這裡可以直接處理
          await reply(event, error.message);
        }
    }
    res.sendStatus(200);
});

// ... (其餘程式碼) ...

(async () => {  // 使用 IIFE (Immediately Invoked Function Expression)
    await setupGoogleCloudKey(); // 設定 Google Cloud 金鑰

    const port = process.env.PORT || 8080;
    app.listen(port, async () => {
        console.log("🚀 Bot is running on port", port);
         await cleanupGoogleCloudKey(); // 啟動後刪除金鑰檔案 (更安全)
    });

})();