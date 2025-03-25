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
  "zh-TW": "繁體中文",
  "zh-CN": "簡體中文",
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
    console.log("🟡 safeReply called");
    console.log("🔑 token:", token);
    console.log("💬 message:", message);

    if (!token || typeof token !== "string" || token.length < 10 || token.length > 50) {
      console.warn("❗ 略過不合法 replyToken：", token);
      return;
    }

    let safeText = typeof message === "string" ? message.trim() : JSON.stringify(message);
    safeText = safeText.slice(0, 4000);
    if (!safeText) {
      console.warn("❗ 無效的訊息：", message);
      return;
    }

    console.log("⚠️ 傳送訊息:", safeText);
    await client.replyMessage(token, { type: "text", text: safeText }).catch(err => {
      console.error("❌ LINE 回覆錯誤（fallback）:", err.response?.data || err.message);
    });
  } catch (err) {
    console.error("❌ 回覆錯誤:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
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
    console.log("👤 使用者:", userId, "說了:", text);

    if (!text) continue;

    console.log("📝 使用者輸入紀錄：", {
      time: new Date(event.timestamp).toISOString(),
      userId,
      message: text
    });

    if (!text.startsWith("/")) {
      // 不以 / 開頭的訊息不處理指令，但如果處於持續翻譯狀態則翻譯
      if (userSession[userId]) {
        const session = userSession[userId];
        const now = Date.now();

        if (now < session.until) {
          const activeLang = session.lang;
          try {
            const res = await axios.post("https://api.openai.com/v1/chat/completions", {
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: `請將使用者的句子翻譯為「${langNameMap[activeLang]}」的自然用法，並且只回傳翻譯內容，不加註解。` },
                { role: "user", content: text },
              ],
            }, {
              headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            });

            let replyText = res.data.choices[0].message.content;
            if (typeof replyText !== "string") replyText = JSON.stringify(replyText);
            replyText = replyText.trim().slice(0, 4000);

            await safeReply(replyToken, replyText);
          } catch (err) {
            console.error("❌ 持續翻譯錯誤:", err.response?.data || err.message);
            await safeReply(replyToken, "⚠️ 自動翻譯失敗，請稍後再試");
          }
        } else {
          delete userSession[userId];
          await safeReply(replyToken, `⌛ 持續翻譯時間已結束，停止翻譯 ${langNameMap[session.lang]}`);
        }
        continue;
      }
      }

      continue;
    }

    if (text === "/stop") {
      if (userSession[userId]) {
        delete userSession[userId];
        return safeReply(replyToken, "🛑 持續翻譯模式已關閉");
      } else {
        return safeReply(replyToken, "ℹ️ 目前未啟用任何持續翻譯模式");
      }
    }

    if (text === "/whoami") {
      return safeReply(replyToken, `🆔 你的 userId 是：${userId}`);
    }

    if (text === "/help") {
      return safeReply(replyToken, `🧭 使用方式：\n1️⃣ 即時翻譯：/語言代碼 文字\n  例如：/ja 今天天氣很好\n\n2️⃣ 啟用持續翻譯模式：/語言代碼 Xmin\n  例如：/en 10min\n  ✅ 可搭配句子直接翻譯：/en 10min I am hungry\n\n3️⃣ 結束持續翻譯模式：/stop\n4️⃣ 查看自己的 userId：/whoami\n\n✅ 支援語言：${allowedLangs.map(l => '/' + l).join(' ')}`);
    }

    if (text === "/test") {
      try {
        const testPrompt = "我好餓";
        const testLang = "en";

        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: `請將使用者的句子翻譯為「${1}語言」的自然用法，並且只回傳翻譯內容，不加註解。` },
            { role: "user", content: testPrompt },
          ],
        }, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        });

        let replyText = res.data.choices[0].message.content;
        if (typeof replyText !== "string") replyText = JSON.stringify(replyText);
        replyText = replyText.trim().slice(0, 4000);

        return safeReply(replyToken, `✅ 測試成功：\n${testPrompt} → ${replyText}`);
      } catch (err) {
        console.error("❌ 測試翻譯錯誤:", err.response?.data || err.message);
        return safeReply(replyToken, "⚠️ 測試失敗，請確認 OpenAI API 是否正確設置");
      }
    }

    const [cmd, timeArg, ...msgRest] = text.split(" ");
    const langCode = cmd.startsWith("/") ? cmd.slice(1) : null;
    const minMatch = timeArg?.match(/^(\d{1,2})min$/);

    if (allowedLangs.includes(langCode) && minMatch) {
      const minutes = parseInt(minMatch[1]);
      if (minutes > 0 && minutes <= 60) {
        userSession[userId] = {
          lang: langCode,
          until: Date.now() + minutes * 60 * 1000,
        };

        const autoTranslateNotice = `🕒 已啟動：${minutes} 分鐘內的訊息將自動翻譯為 ${langNameMap[langCode]}`;

        const immediateMessage = msgRest.join(" ").trim();
        if (immediateMessage) {
          try {
            const res = await axios.post("https://api.openai.com/v1/chat/completions", {
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: `請將使用者的句子翻譯為「${langNameMap[langCode]}」的自然用法，並且只回傳翻譯內容，不加註解。` },
                { role: "user", content: immediateMessage },
              ],
            }, {
              headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            });

            let replyText = res.data.choices[0].message.content;
            if (typeof replyText !== "string") replyText = JSON.stringify(replyText);
            replyText = replyText.trim().slice(0, 4000);

            return safeReply(replyToken, `${autoTranslateNotice}\n\n${immediateMessage} → ${replyText}`);
          } catch (err) {
            console.error("❌ 初始翻譯錯誤:", err.response?.data || err.message);
            return safeReply(replyToken, `${autoTranslateNotice}\n⚠️ 初始翻譯失敗`);
          }
        } else {
          return safeReply(replyToken, autoTranslateNotice);
        }
      }
    }

    const [cmd2, ...rest] = text.split(" ");
    const lang2 = cmd2.startsWith("/") ? cmd2.slice(1) : null;
    const message = rest.join(" ").trim();

    if (allowedLangs.includes(lang2) && message) {
      try {
        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: `請將使用者的句子翻譯為「${langNameMap[lang2]}」的自然用法，並且只回傳翻譯內容，不加註解。` },
            { role: "user", content: message },
          ],
        }, {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        });

        let replyText = res.data.choices[0].message.content;
        if (typeof replyText !== "string") replyText = JSON.stringify(replyText);
        replyText = replyText.trim().slice(0, 4000);

        await safeReply(replyToken, replyText || "⚠️ 翻譯結果為空，請稍後再試");
      } catch (err) {
        console.error("❌ 翻譯錯誤:", err.response?.data || err.message);
        await safeReply(replyToken, "⚠️ 翻譯失敗，請稍後再試");
      }
      return;
    }
  }

  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("✅ Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("🚀 Bot is running on port", port));
