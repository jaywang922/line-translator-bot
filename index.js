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

    // 📝 記錄輸入
    console.log("📝 使用者輸入紀錄：", {
      time: new Date(event.timestamp).toISOString(),
      userId,
      message: text
    });

    // /whoami 指令
    if (text === "/whoami") {
      return safeReply(replyToken, `🆔 你的 userId 是：${userId}`);
    }

    // /help 指令
    if (text === "/help") {
      return safeReply(replyToken, `🧭 使用方式：\n1️⃣ 輸入 /語言代碼 要翻譯的內容\n例如：/ja 今天天氣很好\n✅ 支援語言：${allowedLangs.map(l => '/' + l).join(' ')}`);
    }

    // /test 指令
    if (text === "/test") {
      try {
        const testPrompt = "我好餓";
        const testLang = "en";

        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: `請將以下句子翻譯為 ${testLang}` },
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

    // ✅ 自動翻譯狀態：持續翻譯模式是否啟用
    if (userSession[userId] && Date.now() < userSession[userId].until) {
      const activeLang = userSession[userId].lang;
      try {
        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: `請將以下句子翻譯為 ${activeLang}` },
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
      continue;
    }

    // /語言 Xmin 指令（啟用自動翻譯）
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
        return safeReply(replyToken, `🕒 已啟動：${minutes} 分鐘內的訊息將自動翻譯為 ${langCode}`);
      }
    }

    // 傳統 /語言 文字 格式
    const [cmd2, ...rest] = text.split(" ");
    const lang2 = cmd2.startsWith("/") ? cmd2.slice(1) : null;
    const message = rest.join(" ").trim();

    if (allowedLangs.includes(lang2) && message) {
      try {
        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: `請將以下句子翻譯為 ${lang2}` },
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

    return safeReply(replyToken, `🧭 使用方式錯誤：\n請輸入 /語言 文字，例如：/ja 今天天氣很好\n或 /ja 5min 開啟持續翻譯模式\n\n輸入 /help 查看完整說明`);
  }

  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("✅ Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("🚀 Bot is running on port", port));
