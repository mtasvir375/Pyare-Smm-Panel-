import axios from "axios";
import { getRestDoc, setRestDoc } from "./_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // 1. GET: Return current Telegram Bot Config & Status
    if (req.method === "GET") {
      let cfg: any = null;
      try {
        cfg = await getRestDoc("settings", "telegram_bot");
      } catch (err: any) {
        console.warn("[TELEGRAM-CONFIG-GET-WARN]", err.message);
      }

      if (!cfg) {
        return res.status(200).json({
          success: true,
          running: false,
          enabled: false,
          hasToken: false,
          maskedToken: "",
          chatId: "",
          botUsername: "",
          webhookUrl: "",
          totalAlertsCount: 0,
          unusedAlertsCount: 0
        });
      }

      const botToken = String(cfg.botToken || "").trim();
      let masked = "";
      if (botToken.length > 8) {
        const parts = botToken.split(":");
        if (parts.length === 2) {
          masked = `${parts[0]}:***${parts[1].slice(-4)}`;
        } else {
          masked = `${botToken.slice(0, 4)}***${botToken.slice(-4)}`;
        }
      }

      return res.status(200).json({
        success: true,
        running: !!cfg.enabled,
        enabled: !!cfg.enabled,
        hasToken: !!botToken,
        maskedToken: masked,
        chatId: cfg.chatId || "",
        botUsername: cfg.botUsername || "",
        webhookUrl: cfg.webhookUrl || "",
        startedAt: cfg.startedAt,
        lastError: cfg.lastError,
        totalAlertsCount: cfg.totalAlertsCount || 0,
        unusedAlertsCount: cfg.unusedAlertsCount || 0
      });
    }

    // 2. POST: Save credentials, Start Webhook or Stop Webhook
    if (req.method === "POST") {
      const body = req.body || {};
      const { botToken, chatId, action } = body;

      // Existing saved config
      let existingCfg: any = {};
      try {
        existingCfg = (await getRestDoc("settings", "telegram_bot")) || {};
      } catch (e) {}

      // Clean token (remove all spaces)
      let activeToken = existingCfg.botToken || "";
      if (botToken !== undefined && String(botToken).trim() !== "") {
        activeToken = String(botToken).replace(/\s+/g, "").trim();
      }

      let activeChatId = existingCfg.chatId || "";
      if (chatId !== undefined) {
        activeChatId = String(chatId).trim();
      }

      // If token provided, validate token with Telegram getMe API
      let botUsername = existingCfg.botUsername || "";
      if (activeToken) {
        try {
          const testRes = await axios.get(`https://api.telegram.org/bot${activeToken}/getMe`, { timeout: 8000 });
          if (!testRes.data || !testRes.data.ok) {
            const desc = testRes.data?.description || "Unauthorized";
            return res.status(400).json({
              success: false,
              error: `Invalid Telegram Bot Token (${desc}). Please check the token provided by @BotFather.`
            });
          }
          botUsername = testRes.data.result?.username || "";
        } catch (tgErr: any) {
          const tgDesc = tgErr.response?.data?.description || tgErr.response?.data?.error || tgErr.message;
          return res.status(400).json({
            success: false,
            error: `Telegram validation failed: ${tgDesc}. Please ensure your bot token from @BotFather is correct and complete.`
          });
        }
      }

      // Determine webhook URL
      const host = req.headers["x-forwarded-host"] || req.headers.host || "pyaresmmpanel.online";
      const proto = req.headers["x-forwarded-proto"] || "https";
      const webhookUrl = `${proto}://${host}/api/telegram-webhook`;

      if (action === "start") {
        if (!activeToken) {
          return res.status(400).json({
            success: false,
            error: "Telegram Bot Token is required to start the bot. Please paste your token from @BotFather."
          });
        }

        // Set webhook in Telegram
        try {
          const whRes = await axios.post(
            `https://api.telegram.org/bot${activeToken}/setWebhook`,
            {
              url: webhookUrl,
              drop_pending_updates: false,
              allowed_updates: ["message", "channel_post"]
            },
            { timeout: 8000 }
          );

          if (!whRes.data || !whRes.data.ok) {
            return res.status(400).json({
              success: false,
              error: `Failed to set Telegram webhook: ${whRes.data?.description || "Unknown Telegram error"}`
            });
          }
        } catch (whErr: any) {
          const msg = whErr.response?.data?.description || whErr.message;
          return res.status(400).json({
            success: false,
            error: `Failed to register Telegram webhook: ${msg}`
          });
        }

        const updatedData = {
          ...existingCfg,
          botToken: activeToken,
          chatId: activeChatId,
          botUsername,
          webhookUrl,
          enabled: true,
          startedAt: new Date().toISOString(),
          lastError: null
        };

        await setRestDoc("settings", "telegram_bot", updatedData);
        // Also save to settings/payment for consistency
        try {
          await setRestDoc("settings", "payment", {
            telegramBotToken: activeToken,
            telegramChatId: activeChatId,
            telegramBotEnabled: true,
            telegramBotUsername: botUsername
          });
        } catch (e) {}

        return res.status(200).json({
          success: true,
          message: `Telegram Bot @${botUsername} is now LIVE & listening! Webhook set to ${webhookUrl}`,
          status: {
            running: true,
            enabled: true,
            hasToken: true,
            maskedToken: `${activeToken.split(":")[0]}:***${activeToken.slice(-4)}`,
            chatId: activeChatId,
            botUsername,
            webhookUrl
          }
        });
      }

      if (action === "stop") {
        if (activeToken) {
          try {
            await axios.post(`https://api.telegram.org/bot${activeToken}/deleteWebhook`, {}, { timeout: 6000 });
          } catch (e) {}
        }

        const updatedData = {
          ...existingCfg,
          enabled: false
        };
        await setRestDoc("settings", "telegram_bot", updatedData);
        try {
          await setRestDoc("settings", "payment", {
            telegramBotEnabled: false
          });
        } catch (e) {}

        return res.status(200).json({
          success: true,
          message: "Telegram bot stopped successfully.",
          status: {
            running: false,
            enabled: false,
            hasToken: !!activeToken,
            chatId: activeChatId,
            botUsername
          }
        });
      }

      // Simple Save Credentials
      const updatedData = {
        ...existingCfg,
        ...(activeToken && { botToken: activeToken }),
        chatId: activeChatId,
        botUsername,
        updatedAt: new Date().toISOString()
      };
      await setRestDoc("settings", "telegram_bot", updatedData);
      try {
        await setRestDoc("settings", "payment", {
          ...(activeToken && { telegramBotToken: activeToken }),
          telegramChatId: activeChatId,
          telegramBotUsername: botUsername
        });
      } catch (e) {}

      return res.status(200).json({
        success: true,
        message: "Telegram Bot credentials saved successfully!",
        status: {
          running: !!existingCfg.enabled,
          enabled: !!existingCfg.enabled,
          hasToken: !!activeToken,
          maskedToken: activeToken ? `${activeToken.split(":")[0]}:***${activeToken.slice(-4)}` : "",
          chatId: activeChatId,
          botUsername
        }
      });
    }

    return res.status(405).json({ success: false, error: "Method not allowed" });
  } catch (err: any) {
    console.error("[TELEGRAM-CONFIG-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message || "Failed to process Telegram configuration" });
  }
}
