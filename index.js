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

const safeReply = async (token, message) => {
  try {
    console.log("🟡 safeReply called");
    console.log("🔑 token:", token);
    console.log("💬 message:", message);

    if (!token || typeof token !== "string") {
      console.warn("❗ 無效的 token：", token);
      return;
    }

    const safeText = typeof message === "string" ? message.trim().slice(0, 4000) : JSON.stringify(message).slice(0, 4000);
    if (!safeText) {
      console.warn("❗ 無效的訊息：", message);
      return;
    }

    console.log("⚠️ 傳送訊息:", safeText);
    await client.replyMessage(token, { type: "text", text: safeText });
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
    if (event.type !== "message" || !event.message || event.message.type !== "text") continue;

    const text = event.message.text?.trim();
    const replyToken = event.replyToken;

    if (!text) continue;

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

    // 分析 /語言 指令格式
    const [cmd, ...rest] = text.split(" ");
    const langCode = cmd.startsWith("/") ? cmd.slice(1) : null;
    const message = rest.join(" ").trim();

    // ✅ 格式正確才翻譯
    if (allowedLangs.includes(langCode) && message) {
      try {
        const res = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: `請將以下句子翻譯為 ${langCode}` },
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

    // ❌ 格式錯誤一律回 help
    return safeReply(replyToken, `🧭 使用方式錯誤：\n請輸入 /語言 文字，例如：/ja 今天天氣很好\n\n輸入 /help 查看完整說明`);
  }

  res.sendStatus(200);
});

app.get("/", (_, res) => res.send("✅ Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("🚀 Bot is running on port", port));
