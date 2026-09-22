import * as fs from "fs";
import * as path from "path";
import axios from "axios";

export interface BankAlert {
  id: string;
  utr: string; // 12-digit UTR/RRN
  amount: number; // in INR
  senderBank: string; // e.g. SBI, HDFC, ICICI, Paytm, PhonePe, etc.
  rawText: string;
  timestamp: string; // ISO string
  isUsed: boolean;
  usedBy?: string;
  usedByEmail?: string;
  usedAt?: string;
}

export interface TelegramBotConfig {
  botToken: string;
  chatId?: string;
  enabled: boolean;
  lastUpdateId: number;
  startedAt?: string;
  lastPolledAt?: string;
  lastError?: string;
}

const ALERTS_FILE = path.join(process.cwd(), "bank_alerts.json");
const CONFIG_FILE = path.join(process.cwd(), "telegram_bot_config.json");

// In-memory cache for ultra-fast zero-latency matching
let memoryAlerts: BankAlert[] = [];
let memoryConfig: TelegramBotConfig = {
  botToken: "",
  chatId: "",
  enabled: false,
  lastUpdateId: 0
};
let isPolling = false;
let pollingAbortController: AbortController | null = null;

// Initialize from disk
export function initTelegramBotService() {
  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const data = fs.readFileSync(ALERTS_FILE, "utf-8");
      memoryAlerts = JSON.parse(data);
      if (!Array.isArray(memoryAlerts)) memoryAlerts = [];
    } else {
      memoryAlerts = [];
      saveBankAlerts(memoryAlerts);
    }
  } catch (err: any) {
    console.warn("[TELEGRAM-SERVICE] Error reading bank_alerts.json:", err.message);
    memoryAlerts = [];
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf-8");
      memoryConfig = { ...memoryConfig, ...JSON.parse(data) };
    } else {
      saveTelegramConfig(memoryConfig);
    }
  } catch (err: any) {
    console.warn("[TELEGRAM-SERVICE] Error reading telegram_bot_config.json:", err.message);
  }

  // If bot was previously enabled with a token, resume polling automatically
  if (memoryConfig.enabled && memoryConfig.botToken) {
    console.log("[TELEGRAM-SERVICE] Resuming Telegram bot polling from saved config...");
    startTelegramPolling().catch((e) => {
      console.warn("[TELEGRAM-SERVICE] Auto-start failed:", e.message);
    });
  }
}

export function getBankAlerts(): BankAlert[] {
  return memoryAlerts;
}

export function saveBankAlerts(alerts: BankAlert[]) {
  memoryAlerts = alerts;
  try {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[TELEGRAM-SERVICE] Failed to write bank_alerts.json:", err.message);
  }
}

export function getTelegramConfig(): TelegramBotConfig {
  return memoryConfig;
}

export function saveTelegramConfig(cfg: Partial<TelegramBotConfig>): TelegramBotConfig {
  const cleanedCfg = { ...cfg };
  if (cleanedCfg.botToken !== undefined) {
    cleanedCfg.botToken = String(cleanedCfg.botToken).replace(/\s+/g, "").trim();
  }
  memoryConfig = { ...memoryConfig, ...cleanedCfg };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(memoryConfig, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[TELEGRAM-SERVICE] Failed to write telegram_bot_config.json:", err.message);
  }
  return memoryConfig;
}

/**
 * Robust Indian Bank / UPI SMS parser
 * Extracts 12-digit UTR, Amount in INR, and Bank Name.
 */
export function parseBankSms(rawText: string, senderName?: string): {
  utr: string;
  amount: number;
  bank: string;
  isValid: boolean;
  reason?: string;
} {
  const text = String(rawText || "").trim();
  if (!text) {
    return { utr: "", amount: 0, bank: "Unknown", isValid: false, reason: "Empty SMS text" };
  }

  // 1. Detect if debit message (ignore unless clearly credit)
  const isDebit = /\b(debited|spent|withdrawn|sent\s+rs|paid\s+rs|transferred\s+to)\b/i.test(text);
  const isCredit = /\b(credited|received|deposit|deposited|added|cr\b|payment\s+received|received\s+payment|jama|prapt)\b/i.test(text);
  if (isDebit && !isCredit) {
    return { utr: "", amount: 0, bank: "Unknown", isValid: false, reason: "Debit notification ignored" };
  }

  // 2. Extract 12-digit UTR / RRN
  // Priority 1: Labelled UTR patterns
  let utr = "";
  const utrPatterns = [
    /(?:upi\s*ref(?:\s*no|\s*id)?|ref(?:\s*no|\s*id)?|utr(?:\s*no|\s*id)?|rrn|txn\s*id|txnid|upi\s*id|reference\s*no)[\s:/-]*([0-9]{12})\b/i,
    /(?:upi\/|upi:\s*)([0-9]{12})\b/i,
    /\b([0-9]{12})\b/
  ];

  for (const pat of utrPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      utr = m[1];
      break;
    }
  }

  if (!utr) {
    return { utr: "", amount: 0, bank: "Unknown", isValid: false, reason: "No 12-digit UTR found" };
  }

  // 3. Extract Amount in INR
  let amount = 0;
  const amountPatterns = [
    /(?:credited\s*(?:by|with)?|received|deposited|payment\s*of)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i
  ];

  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const cleanNum = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(cleanNum) && cleanNum > 0) {
        amount = cleanNum;
        break;
      }
    }
  }

  if (!amount || amount <= 0) {
    return { utr, amount: 0, bank: "Unknown", isValid: false, reason: "Amount not detected in SMS" };
  }

  // 4. Extract Bank / UPI Provider
  let bank = "UPI Payment";
  const upperText = `${text} ${senderName || ""}`.toUpperCase();

  if (upperText.includes("SBI") || upperText.includes("STATE BANK")) bank = "State Bank of India (SBI)";
  else if (upperText.includes("HDFC")) bank = "HDFC Bank";
  else if (upperText.includes("ICICI")) bank = "ICICI Bank";
  else if (upperText.includes("PAYTM") || upperText.includes("PYTM")) bank = "Paytm Payments Bank";
  else if (upperText.includes("PHONEPE")) bank = "PhonePe UPI";
  else if (upperText.includes("GPAY") || upperText.includes("GOOGLE PAY")) bank = "Google Pay";
  else if (upperText.includes("AXIS")) bank = "Axis Bank";
  else if (upperText.includes("KOTAK")) bank = "Kotak Mahindra Bank";
  else if (upperText.includes("BOB") || upperText.includes("BARODA")) bank = "Bank of Baroda";
  else if (upperText.includes("PNB") || upperText.includes("PUNJAB")) bank = "Punjab National Bank";
  else if (upperText.includes("CANARA")) bank = "Canara Bank";
  else if (upperText.includes("UNION")) bank = "Union Bank of India";
  else if (upperText.includes("INDUSIND")) bank = "IndusInd Bank";
  else if (upperText.includes("AIRTEL")) bank = "Airtel Payments Bank";

  return {
    utr,
    amount,
    bank,
    isValid: true
  };
}

/**
 * Add an alert safely with UTR deduplication
 */
export function addBankAlert(params: {
  utr: string;
  amount: number;
  senderBank: string;
  rawText: string;
}): { success: boolean; alert?: BankAlert; duplicate?: boolean } {
  const cleanUtr = String(params.utr || "").replace(/\D/g, "").trim();
  if (cleanUtr.length !== 12) {
    return { success: false };
  }

  // Check deduplication
  const existing = memoryAlerts.find((a) => a.utr === cleanUtr);
  if (existing) {
    return { success: false, duplicate: true, alert: existing };
  }

  const newAlert: BankAlert = {
    id: `alert_${cleanUtr}_${Date.now()}`,
    utr: cleanUtr,
    amount: Number(params.amount),
    senderBank: params.senderBank || "UPI Payment",
    rawText: params.rawText || "",
    timestamp: new Date().toISOString(),
    isUsed: false
  };

  // Prepend new alert (newest first)
  memoryAlerts.unshift(newAlert);
  // Keep max 500 alerts in file to save disk/memory
  if (memoryAlerts.length > 500) {
    memoryAlerts = memoryAlerts.slice(0, 500);
  }
  saveBankAlerts(memoryAlerts);

  console.log(`[TELEGRAM-ALERT-SAVED] UTR: ${cleanUtr} | Amount: ₹${newAlert.amount} | Bank: ${newAlert.senderBank}`);
  return { success: true, alert: newAlert };
}

/**
 * Verify and claim an alert from bank_alerts.json (0 Firestore reads!)
 */
export function verifyAndClaimAlert(
  utr: string,
  expectedAmount?: number,
  userId?: string,
  userEmail?: string
): { success: boolean; status: number; alert?: BankAlert; error?: string } {
  const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
  if (cleanUtr.length !== 12) {
    return { success: false, status: 400, error: "Please enter a valid 12-digit UTR number." };
  }

  const alert = memoryAlerts.find((a) => a.utr === cleanUtr);
  if (!alert) {
    return {
      success: false,
      status: 404,
      error: `Payment verification pending: No bank alert received for UTR ${cleanUtr} yet. If you just sent payment, please wait 15–30 seconds for the bank confirmation SMS to process, then click Verify again.`
    };
  }

  if (alert.isUsed) {
    return {
      success: false,
      status: 400,
      error: `This UTR (${cleanUtr}) has already been claimed and credited to an account. Duplicate submissions are not permitted.`
    };
  }

  if (expectedAmount && expectedAmount > 0) {
    const diff = Math.abs(alert.amount - expectedAmount);
    // Allow small rounding tolerance of ₹1
    if (diff > 1) {
      return {
        success: false,
        status: 400,
        error: `Amount mismatch: The bank alert for UTR ${cleanUtr} is for ₹${alert.amount}, but you entered ₹${expectedAmount}.`
      };
    }
  }

  // Mark as used
  alert.isUsed = true;
  alert.usedBy = userId || "unknown";
  alert.usedByEmail = userEmail || "";
  alert.usedAt = new Date().toISOString();

  saveBankAlerts(memoryAlerts);

  return { success: true, status: 200, alert };
}

/**
 * Send an acknowledgment message to Telegram chat
 */
async function sendTelegramReply(botToken: string, chatId: string | number, text: string) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text,
        parse_mode: "HTML"
      },
      { timeout: 5000 }
    );
  } catch (err: any) {
    console.warn("[TELEGRAM-SERVICE] Failed to send Telegram reply:", err.message);
  }
}

/**
 * Telegram Long-Polling Loop
 */
export async function startTelegramPolling(): Promise<{ success: boolean; message: string }> {
  if (isPolling) {
    return { success: true, message: "Telegram bot is already running." };
  }

  const token = memoryConfig.botToken.replace(/\s+/g, "").trim();
  if (!token) {
    return { success: false, message: "Bot token is missing. Please provide a valid Telegram Bot Token from @BotFather." };
  }

  // Verify token via getMe
  try {
    const meRes = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 8000 });
    if (!meRes.data || !meRes.data.ok) {
      const errMsg = meRes.data?.description || "Invalid Telegram Bot Token";
      saveTelegramConfig({ lastError: errMsg });
      return { success: false, message: `Telegram Error: ${errMsg}. Please verify your bot token with @BotFather.` };
    }
    console.log(`[TELEGRAM-SERVICE] Bot authenticated successfully as @${meRes.data.result.username}`);
  } catch (netErr: any) {
    const desc = netErr.response?.data?.description;
    const msg = desc 
      ? `Telegram Error: ${desc}. Please verify your token from @BotFather.`
      : (netErr.message || "Failed to reach Telegram API");
    saveTelegramConfig({ lastError: msg });
    return { success: false, message: msg };
  }

  isPolling = true;
  saveTelegramConfig({
    enabled: true,
    startedAt: new Date().toISOString(),
    lastError: undefined
  });

  pollingAbortController = new AbortController();

  // Run polling loop asynchronously
  (async () => {
    console.log("[TELEGRAM-SERVICE] Telegram polling loop started.");
    let consecutiveErrors = 0;

    while (isPolling) {
      try {
        const offset = (memoryConfig.lastUpdateId || 0) + 1;
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`;

        const res = await axios.get(url, {
          timeout: 30000,
          signal: pollingAbortController?.signal
        });

        consecutiveErrors = 0;
        saveTelegramConfig({ lastPolledAt: new Date().toISOString() });

        if (res.data && res.data.ok && Array.isArray(res.data.result)) {
          const updates = res.data.result;

          for (const update of updates) {
            if (update.update_id > (memoryConfig.lastUpdateId || 0)) {
              memoryConfig.lastUpdateId = update.update_id;
              saveTelegramConfig({ lastUpdateId: update.update_id });
            }

            // Extract message or channel_post
            const msg = update.message || update.channel_post || update.edited_message;
            if (!msg) continue;

            const text = msg.text || msg.caption || "";
            const senderName = msg.from ? `${msg.from.first_name || ""} ${msg.from.last_name || ""}` : "";
            const chatId = msg.chat?.id;

            if (text) {
              // Check for /start or /status command
              if (text.trim() === "/start" || text.trim() === "/status") {
                const total = memoryAlerts.length;
                const unused = memoryAlerts.filter((a) => !a.isUsed).length;
                await sendTelegramReply(
                  token,
                  chatId,
                  `🤖 <b>SMM Panel UPI Payment Bot is Active!</b>\n\n` +
                  `Forward any Bank SMS or UPI payment notification into this chat.\n` +
                  `📊 <b>Stats:</b>\n` +
                  `• Total Alerts: ${total}\n` +
                  `• Available (Unused): ${unused}\n\n` +
                  `When users enter the 12-digit UTR on the website, their wallet will be credited instantly!`
                );
                continue;
              }

              // Parse as bank SMS
              const parsed = parseBankSms(text, senderName);
              if (parsed.isValid && parsed.utr && parsed.amount > 0) {
                const result = addBankAlert({
                  utr: parsed.utr,
                  amount: parsed.amount,
                  senderBank: parsed.bank,
                  rawText: text
                });

                if (result.success && result.alert) {
                  await sendTelegramReply(
                    token,
                    chatId,
                    `✅ <b>Payment Alert Captured!</b>\n\n` +
                    `💰 <b>Amount:</b> ₹${parsed.amount}\n` +
                    `🔢 <b>UTR / Ref:</b> <code>${parsed.utr}</code>\n` +
                    `🏦 <b>Bank:</b> ${parsed.bank}\n` +
                    `🟢 <b>Status:</b> Ready for instant wallet claim.`
                  );
                } else if (result.duplicate) {
                  await sendTelegramReply(
                    token,
                    chatId,
                    `ℹ️ <b>Duplicate SMS:</b> UTR <code>${parsed.utr}</code> (₹${parsed.amount}) is already recorded in the database.`
                  );
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (!isPolling) break; // User stopped the bot

        consecutiveErrors++;
        const errMsg = err.response?.data?.description || err.message;
        console.warn(`[TELEGRAM-POLLING-ERROR] #${consecutiveErrors}:`, errMsg);

        saveTelegramConfig({ lastError: errMsg });

        // Exponential backoff up to 15s
        const sleepMs = Math.min(2000 * consecutiveErrors, 15000);
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }

    console.log("[TELEGRAM-SERVICE] Telegram polling loop terminated.");
  })();

  return { success: true, message: "Telegram bot polling started successfully." };
}

export function stopTelegramPolling(): { success: boolean; message: string } {
  isPolling = false;
  if (pollingAbortController) {
    try {
      pollingAbortController.abort();
    } catch (e) {}
    pollingAbortController = null;
  }
  saveTelegramConfig({ enabled: false });
  console.log("[TELEGRAM-SERVICE] Stopped Telegram bot polling.");
  return { success: true, message: "Telegram bot stopped." };
}

export function getTelegramStatus() {
  const totalAlerts = memoryAlerts.length;
  const unusedAlerts = memoryAlerts.filter((a) => !a.isUsed).length;

  const rawToken = memoryConfig.botToken || "";
  let maskedToken = "";
  if (rawToken.length > 10) {
    maskedToken = `${rawToken.slice(0, 6)}...${rawToken.slice(-4)}`;
  } else if (rawToken) {
    maskedToken = "******";
  }

  return {
    running: isPolling,
    enabled: memoryConfig.enabled,
    hasToken: !!rawToken,
    maskedToken,
    chatId: memoryConfig.chatId || "",
    startedAt: memoryConfig.startedAt,
    lastPolledAt: memoryConfig.lastPolledAt,
    lastError: memoryConfig.lastError,
    totalAlertsCount: totalAlerts,
    unusedAlertsCount: unusedAlerts
  };
}

/**
 * Simulate an incoming bank SMS (for testing without real money)
 */
export function simulateBankSms(params?: {
  amount?: number;
  utr?: string;
  bank?: string;
  text?: string;
}): { success: boolean; alert: BankAlert } {
  const amount = params?.amount && params.amount > 0 ? params.amount : Math.floor(Math.random() * 400) + 100;
  const utr = params?.utr && params.utr.length === 12
    ? params.utr
    : `${Math.floor(400000000000 + Math.random() * 599999999999)}`;
  const bank = params?.bank || "State Bank of India (SBI)";

  const dateStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  const text = params?.text || `Dear SBI UPI User, A/C ..4102 credited by Rs.${amount}.00 on ${dateStr} transfer from Payer Ref No ${utr} -SBI`;

  const res = addBankAlert({
    utr,
    amount,
    senderBank: bank,
    rawText: text
  });

  return {
    success: true,
    alert: res.alert || memoryAlerts.find((a) => a.utr === utr)!
  };
}
