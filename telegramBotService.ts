import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { setRestDoc, getRestDoc } from "./api/_firestoreRest";

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

export interface RawBotMessage {
  id: string;
  timestamp: string;
  sender: string;
  chatId: string | number;
  text: string;
  parsed: boolean;
  utr?: string;
  amount?: number;
  bank?: string;
  reason?: string;
}

export interface PaymentIntent {
  intentId: string;
  orderRef: string;
  baseAmount: number;
  amount: number;
  userId: string;
  userEmail: string;
  upiId: string;
  payeeName: string;
  upiLink: string;
  status: "pending" | "completed" | "expired";
  createdAt: number;
  expiresAt: number;
  completedAt?: number;
  utr?: string;
  senderBank?: string;
  notified?: boolean;
}

export type PaymentIntentCallback = (
  intent: PaymentIntent,
  utr?: string,
  rawText?: string
) => Promise<boolean>;

export interface TelegramBotConfig {
  botToken: string;
  botUsername?: string;
  chatId?: string;
  upiId?: string;
  payeeName?: string;
  enabled: boolean;
  lastUpdateId: number;
  startedAt?: string;
  lastPolledAt?: string;
  lastError?: string;
  mode?: "polling" | "webhook";
  webhookUrl?: string;
}

const ALERTS_FILE = path.join(process.cwd(), "bank_alerts.json");
const CONFIG_FILE = path.join(process.cwd(), "telegram_bot_config.json");
const INTENTS_FILE = path.join(process.cwd(), "payment_intents.json");

// In-memory cache for ultra-fast zero-latency matching
let memoryAlerts: BankAlert[] = [];
let memoryRawMessages: RawBotMessage[] = [];
let memoryIntents: Map<string, PaymentIntent> = new Map();
const notifiedIntents: Set<string> = new Set();
let intentMatchCallback: PaymentIntentCallback | null = null;

let memoryConfig: TelegramBotConfig = {
  botToken: "",
  chatId: "",
  upiId: "paytmqr281005050101111956557626@paytm",
  payeeName: "Pyare SMM Panel",
  enabled: false,
  lastUpdateId: 0
};
let isPolling = false;
let pollingAbortController: AbortController | null = null;
let lastSuccessfulPollTime = Date.now();
let watchdogInterval: NodeJS.Timeout | null = null;
let currentLoopEpoch = 0;

export function registerPaymentIntentCallback(cb: PaymentIntentCallback) {
  intentMatchCallback = cb;
}

export function savePaymentIntents() {
  try {
    const list = Array.from(memoryIntents.values()).slice(-200); // keep recent 200
    fs.writeFileSync(INTENTS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[TELEGRAM-SERVICE] Failed to write payment_intents.json:", err.message);
  }
}

export function getPaymentIntent(intentId: string): PaymentIntent | null {
  const intent = memoryIntents.get(intentId);
  if (!intent) return null;
  if (intent.status === "pending" && intent.expiresAt < Date.now()) {
    intent.status = "expired";
    savePaymentIntents();
  }
  return intent;
}

export function getAllPaymentIntents(): PaymentIntent[] {
  return Array.from(memoryIntents.values());
}

/**
 * Dynamic Zero-Collision QR Engine
 * Generates unique decimal amount and unique Order Ref
 */
export function createPaymentIntent(params: {
  baseAmount: number;
  userId: string;
  userEmail?: string;
  upiId?: string;
  payeeName?: string;
}): { success: boolean; intent?: PaymentIntent; error?: string } {
  const base = Number(params.baseAmount);
  if (!base || isNaN(base) || base < 1) {
    return { success: false, error: "Minimum deposit amount is ₹1." };
  }
  if (!params.userId) {
    return { success: false, error: "User ID is required." };
  }

  const now = Date.now();
  // Mark expired pending intents
  for (const [_, it] of memoryIntents.entries()) {
    if (it.status === "pending" && it.expiresAt < now) {
      it.status = "expired";
    }
  }

  // Find active pending intents within 5 minute window
  const activePending = Array.from(memoryIntents.values()).filter(
    (i) => i.status === "pending" && i.expiresAt > now
  );

  // Dynamic Zero-Collision Decimal Avoidance
  const activeAmountsInPaise = new Set(
    activePending.map((i) => Math.round(i.amount * 100))
  );

  const baseInPaise = Math.round(base * 100);
  let selectedPaise = baseInPaise;
  let offset = 0;
  // If exact amount is already pending for another active session, offset by 0.01 up to 0.99
  while (activeAmountsInPaise.has(selectedPaise) && offset < 99) {
    offset++;
    selectedPaise = baseInPaise + offset;
  }
  const finalAmount = Number((selectedPaise / 100).toFixed(2));

  // Generate unique Order Ref: e.g. BSM84920
  const existingRefs = new Set(activePending.map((i) => i.orderRef.toUpperCase()));
  let orderRef = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `BSM${Math.floor(10000 + Math.random() * 90000)}`;
    if (!existingRefs.has(candidate)) {
      orderRef = candidate;
      break;
    }
  }
  if (!orderRef) {
    orderRef = `BSM${Date.now().toString().slice(-5)}`;
  }

  const activeUpi = (params.upiId || memoryConfig.upiId || "paytmqr281005050101111956557626@paytm").trim();
  const activeName = (params.payeeName || memoryConfig.payeeName || "Pyare SMM Panel").trim();

  // Dynamic UPI Link Format:
  // upi://pay?pa={UPI_ID}&pn={NAME}&am={AMOUNT}&tr={REF}&tn={REF}&cu=INR
  const upiLink = `upi://pay?pa=${encodeURIComponent(activeUpi)}&pn=${encodeURIComponent(activeName)}&am=${finalAmount.toFixed(2)}&tr=${orderRef}&tn=${orderRef}&cu=INR`;
  const intentId = `pi_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes validity

  const intent: PaymentIntent = {
    intentId,
    orderRef,
    baseAmount: base,
    amount: finalAmount,
    userId: params.userId,
    userEmail: params.userEmail || "",
    upiId: activeUpi,
    payeeName: activeName,
    upiLink,
    status: "pending",
    createdAt: now,
    expiresAt,
    notified: false
  };

  memoryIntents.set(intentId, intent);
  savePaymentIntents();

  console.log(`[PAYMENT-INTENT-CREATED] Created intent ${intentId}: ₹${finalAmount} (Ref: ${orderRef}) for user ${params.userId}`);

  return { success: true, intent };
}

/**
 * Match an incoming SMS/alert against active pending intents
 */
export function findMatchingIntent(params: {
  orderRef?: string | null;
  amount?: number;
  utr?: string;
}): PaymentIntent | null {
  const now = Date.now();
  const active = Array.from(memoryIntents.values()).filter(
    (i) => i.status === "pending" && i.expiresAt > now
  );

  // 1. By Order Reference (exact BSM84920 match)
  if (params.orderRef) {
    const cleanRef = params.orderRef.toUpperCase().trim();
    const byRef = active.find((i) => i.orderRef.toUpperCase() === cleanRef);
    if (byRef) return byRef;
  }

  // 2. By Exact Decimal Amount (collision-free exact paise match, e.g. 100.01)
  if (params.amount && params.amount > 0) {
    const byAmount = active.find((i) => Math.abs(i.amount - params.amount!) < 0.005);
    if (byAmount) return byAmount;
  }

  // 3. By UTR if already mapped
  if (params.utr && params.utr.length === 12) {
    const byUtr = active.find((i) => i.utr === params.utr);
    if (byUtr) return byUtr;
  }

  return null;
}

function recordIncomingMessage(entry: Omit<RawBotMessage, "id" | "timestamp">) {
  const item: RawBotMessage = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry
  };
  memoryRawMessages.unshift(item);
  if (memoryRawMessages.length > 25) {
    memoryRawMessages.pop();
  }
}

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
    }
  } catch (err: any) {
    console.warn("[TELEGRAM-SERVICE] Error reading telegram_bot_config.json:", err.message);
  }

  try {
    if (fs.existsSync(INTENTS_FILE)) {
      const data = fs.readFileSync(INTENTS_FILE, "utf-8");
      const list: PaymentIntent[] = JSON.parse(data);
      if (Array.isArray(list)) {
        memoryIntents = new Map(list.map((it) => [it.intentId, it]));
        for (const it of list) {
          if (it.notified || it.status === "completed") {
            notifiedIntents.add(it.intentId);
            notifiedIntents.add(it.orderRef);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("[TELEGRAM-SERVICE] Error reading payment_intents.json:", err.message);
  }

  // If memoryConfig token is empty or invalid (< 35 chars), sync from Firestore
  if (!memoryConfig.botToken || memoryConfig.botToken.length < 35) {
    getRestDoc("settings", "telegram_bot").then((tgDoc) => {
      if (tgDoc && tgDoc.botToken && tgDoc.botToken.length >= 35) {
        memoryConfig.botToken = tgDoc.botToken.replace(/\s+/g, "").trim();
        memoryConfig.chatId = tgDoc.chatId || memoryConfig.chatId;
        memoryConfig.enabled = tgDoc.enabled !== false;
        saveTelegramConfig(memoryConfig);
        console.log("[TELEGRAM-SERVICE] Restored bot token from Firestore settings/telegram_bot");
        if (memoryConfig.enabled) {
          startTelegramPolling().catch((e) => console.warn("[TELEGRAM-SERVICE] Auto-start error:", e.message));
        }
      }
    }).catch(() => {});
  } else if (memoryConfig.enabled && memoryConfig.botToken) {
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
  // Ensure "transferred to your a/c" or "credited" is NOT mistaken for debit
  const isExplicitDebit = /\b(debited\s+from|money\s+debited|debited\s+by|sent\s+to\s+[a-zA-Z]|paid\s+to\s+[a-zA-Z]|withdrawn\s+from)\b/i.test(text);
  const isCredit = /\b(credited|credit|received|deposit|deposited|added|cr\.?|jama|prapt|transferred\s+to\s+your|transferred\s+from|transfer\s+from|payment\s+received|money\s+received|received\s+rs|rcvd\s+rs|rcvd|payment\s+of)\b/i.test(text);

  if (isExplicitDebit && !isCredit) {
    return { utr: "", amount: 0, bank: "Unknown", isValid: false, reason: "Debit notification ignored" };
  }

  // 2. Extract 12-digit UTR / RRN
  let utr = "";
  const labelledUtrPatterns = [
    /(?:upi\s*ref(?:\s*no|\s*id)?|ref(?:\s*no|\s*id)?|utr(?:\s*no|\s*id)?|rrn|txn\s*id|txnid|upi\s*id|reference\s*(?:no|num)?|upi\/|upi:\s*)[\s:/-]*([0-9]{12})\b/i,
    /(?:imps|neft|rtgs|cms)[\s:/-]*([0-9]{12})\b/i,
    /\b([0-9]{12})\b/
  ];

  for (const pat of labelledUtrPatterns) {
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
    /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i,
    /(?:credited|received|deposited|deposit|added|payment\s+of|amt|amount|paid)\s*(?:by|with|for|of|is|:)?\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /transferred\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i
  ];

  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const cleanNum = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(cleanNum) && cleanNum > 0 && cleanNum !== parseFloat(utr)) {
        amount = cleanNum;
        break;
      }
    }
  }

  // Fallback: If no currency prefix/suffix was used, extract any standalone number (1 to 6 digits) that is not the UTR
  if (!amount || amount <= 0) {
    const remainingText = text.replace(new RegExp(utr, "g"), " ");
    const genericMatches = remainingText.match(/\b([1-9][0-9]{0,5}(?:\.[0-9]{1,2})?)\b/g);
    if (genericMatches) {
      for (const numStr of genericMatches) {
        const num = parseFloat(numStr);
        // Exclude 4-digit years
        if (num >= 1 && num <= 200000 && num !== 2024 && num !== 2025 && num !== 2026 && num !== 2027) {
          amount = num;
          break;
        }
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
  else if (upperText.includes("CENTBK") || upperText.includes("CENTRAL BANK") || upperText.includes("CBOI") || upperText.includes("CBOL")) bank = "Central Bank of India";
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

  // Sync to Firestore collections in background so website sees it under any domain / environment
  try {
    setRestDoc("bank_alerts", cleanUtr, newAlert).catch((err: any) => {
      console.warn("[FIRESTORE-REST-ALERT-SYNC-WARN]", err.message);
    });
    setRestDoc("sms_forwarder_pool", cleanUtr, {
      utr: cleanUtr,
      amount: newAlert.amount,
      sender: newAlert.senderBank,
      rawSms: newAlert.rawText,
      timestamp: newAlert.timestamp,
      status: "available"
    }).catch(() => {});
  } catch (syncErr) {
    // Non-blocking
  }

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
export async function sendTelegramReply(botToken: string, chatId: string | number, text: string) {
  if (!chatId) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try { controller.abort(); } catch {}
    }, 6000);

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connection": "close"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML"
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch (err: any) {
    console.warn("[TELEGRAM-SERVICE] Failed to send Telegram reply:", err.message);
  }
}

interface PartialMessageState {
  utr?: string;
  amount?: number;
  bank?: string;
  rawText?: string;
  senderName?: string;
  timestamp: number;
}
const partialMessageByChat = new Map<string, PartialMessageState>();

function extractAmountOnly(text: string): number {
  const amountPatterns = [
    /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i,
    /(?:credited|received|deposited|deposit|added|payment\s+of|amt|amount|paid)\s*(?:by|with|for|of|is|:)?\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /transferred\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i
  ];
  for (const pat of amountPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const clean = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(clean) && clean > 0) return clean;
    }
  }
  return 0;
}

function extractBankOnly(text: string, senderName?: string): string {
  const upper = `${text} ${senderName || ""}`.toUpperCase();
  if (upper.includes("SBI") || upper.includes("STATE BANK")) return "State Bank of India (SBI)";
  if (upper.includes("CENTBK") || upper.includes("CENTRAL BANK") || upper.includes("CBOI") || upper.includes("CBOL")) return "Central Bank of India";
  if (upper.includes("HDFC")) return "HDFC Bank";
  if (upper.includes("ICICI")) return "ICICI Bank";
  if (upper.includes("PAYTM") || upper.includes("PYTM")) return "Paytm Payments Bank";
  if (upper.includes("PHONEPE")) return "PhonePe UPI";
  if (upper.includes("GPAY") || upper.includes("GOOGLE PAY")) return "Google Pay";
  if (upper.includes("AXIS")) return "Axis Bank";
  if (upper.includes("KOTAK")) return "Kotak Mahindra Bank";
  if (upper.includes("BOB") || upper.includes("BARODA")) return "Bank of Baroda";
  if (upper.includes("PNB") || upper.includes("PUNJAB")) return "Punjab National Bank";
  if (upper.includes("CANARA")) return "Canara Bank";
  if (upper.includes("UNION")) return "Union Bank of India";
  if (upper.includes("INDUSIND")) return "IndusInd Bank";
  return "UPI Payment";
}

/**
 * Unified Telegram update processor used by BOTH polling AND webhooks
 */
export async function processTelegramUpdate(update: any, token: string): Promise<{
  success: boolean;
  isCommand?: boolean;
  alert?: BankAlert;
  duplicate?: boolean;
  parsed?: any;
  reason?: string;
}> {
  if (!update || typeof update !== "object") {
    return { success: false, reason: "Invalid update payload" };
  }

  const msg = update.message || update.channel_post || update.edited_message || update.business_message;
  if (!msg) {
    return { success: false, reason: "No message in update" };
  }

  const text = String(msg.text || msg.caption || "").trim();
  const senderName = msg.from
    ? `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim() || msg.from.username || "User"
    : (msg.chat?.title || "Channel/Group");
  const chatId = msg.chat?.id;

  if (!text) {
    return { success: false, reason: "Message has no text or caption" };
  }

  console.log(`[TELEGRAM-MSG-IN] From: ${senderName} (Chat: ${chatId}): "${text.replace(/\n/g, " ")}"`);

  // Handle /start, /status, /help commands
  if (text === "/start" || text === "/status" || text.startsWith("/start ") || text === "/help") {
    const total = memoryAlerts.length;
    const unused = memoryAlerts.filter((a) => !a.isUsed).length;
    recordIncomingMessage({
      sender: senderName,
      chatId: chatId || "",
      text,
      parsed: true,
      reason: "Command /start executed"
    });

    await sendTelegramReply(
      token,
      chatId,
      `🤖 <b>Pyare SMM Panel UPI Payment Bot is Active!</b>\n\n` +
      `Forward any Indian Bank SMS or UPI payment notification into this chat.\n\n` +
      `📊 <b>Live Database Stats:</b>\n` +
      `• Total Recorded Alerts: <b>${total}</b>\n` +
      `• Unused & Ready to Claim: <b>${unused}</b>\n\n` +
      `<i>Format Tip: Forward the SMS from your bank (e.g. SBI, HDFC, ICICI, Central Bank, Paytm, PhonePe, GPay). As soon as the 12-digit UTR is detected, it will be added to the website!</i>`
    );
    return { success: true, isCommand: true };
  }

  // Parse Bank SMS
  let parsed = parseBankSms(text, senderName);
  const chatKey = String(chatId || "");

  // Multi-part / Split SMS Handler (e.g. UTR in one message, amount in another)
  const pending = partialMessageByChat.get(chatKey);
  const isPendingValid = pending && (Date.now() - pending.timestamp < 180000);

  const standaloneUtrMatch = text.replace(/[\s\-_]/g, "").match(/\b([0-9]{12})\b/);
  const detectedUtr = standaloneUtrMatch ? standaloneUtrMatch[1] : (parsed.utr || "");

  // ========================================================
  // ZERO-UTR INTENT MATCHING ENGINE (Dynamic QR Payments)
  // ========================================================
  const refMatch = text.match(/\b(BSM[A-Z0-9]{4,8})\b/i);
  const detectedRef = refMatch ? refMatch[1].toUpperCase() : null;
  const detectedAmount = parsed.amount > 0 ? parsed.amount : extractAmountOnly(text);
  const detectedBank = (parsed.bank && parsed.bank !== "Unknown") ? parsed.bank : extractBankOnly(text, senderName);

  const matchedIntent = findMatchingIntent({
    orderRef: detectedRef,
    amount: detectedAmount > 0 ? detectedAmount : undefined,
    utr: detectedUtr && detectedUtr.length === 12 ? detectedUtr : undefined
  });

  if (matchedIntent) {
    console.log(`[ZERO-UTR-MATCH] Matched Order: ${matchedIntent.orderRef}, Amount: ₹${matchedIntent.amount} for user: ${matchedIntent.userId}`);
    matchedIntent.status = "completed";
    matchedIntent.completedAt = Date.now();
    matchedIntent.utr = (detectedUtr && detectedUtr.length === 12) ? detectedUtr : (detectedRef || matchedIntent.orderRef);
    matchedIntent.senderBank = detectedBank;
    savePaymentIntents();

    recordIncomingMessage({
      sender: senderName,
      chatId: chatId || "",
      text,
      parsed: true,
      utr: matchedIntent.utr,
      amount: matchedIntent.amount,
      bank: detectedBank,
      reason: `Zero-UTR Matched Order ${matchedIntent.orderRef}`
    });

    // Execute wallet credit callback
    if (intentMatchCallback) {
      try {
        await intentMatchCallback(matchedIntent, matchedIntent.utr, text);
      } catch (cbErr: any) {
        console.error("[ZERO-UTR-CALLBACK-ERR]", cbErr.message);
      }
    }

    // STRICT SINGLE-NOTIFICATION:
    const notificationKey = matchedIntent.intentId;
    if (!notifiedIntents.has(notificationKey) && !matchedIntent.notified) {
      notifiedIntents.add(notificationKey);
      notifiedIntents.add(matchedIntent.orderRef);
      matchedIntent.notified = true;
      savePaymentIntents();

      const targetChat = memoryConfig.chatId || chatId;
      if (targetChat) {
        await sendTelegramReply(
          token,
          targetChat,
          `✅ <b>Payment Verified!</b>\n\n` +
          `💰 <b>Amount:</b> ₹${matchedIntent.amount.toFixed(2)}\n` +
          `🆔 <b>Order Ref:</b> <code>${matchedIntent.orderRef}</code>\n` +
          `🔢 <b>UTR:</b> <code>${matchedIntent.utr}</code>\n` +
          `👤 <b>User:</b> ${matchedIntent.userEmail || matchedIntent.userId}\n` +
          `🏦 <b>Gateway:</b> ${detectedBank}\n` +
          `🟢 <b>Status:</b> Wallet Credited Instantly (Zero-UTR Auto)`
        );
      }
    }

    return {
      success: true,
      alert: {
        id: `alert_intent_${matchedIntent.intentId}`,
        utr: matchedIntent.utr,
        amount: matchedIntent.amount,
        senderBank: detectedBank,
        rawText: text,
        timestamp: new Date().toISOString(),
        isUsed: true,
        usedBy: matchedIntent.userId,
        usedByEmail: matchedIntent.userEmail,
        usedAt: new Date().toISOString()
      },
      parsed: { utr: matchedIntent.utr, amount: matchedIntent.amount, bank: detectedBank }
    };
  }

  if (detectedUtr && (!parsed.isValid || parsed.amount <= 0)) {
    if (isPendingValid && pending.amount && pending.amount > 0) {
      console.log(`[TELEGRAM-STITCH] Merging UTR ${detectedUtr} with pending amount ₹${pending.amount} from chat ${chatKey}`);
      parsed = {
        utr: detectedUtr,
        amount: pending.amount,
        bank: pending.bank || "UPI Payment",
        isValid: true
      };
      partialMessageByChat.delete(chatKey);
    } else {
      partialMessageByChat.set(chatKey, {
        utr: detectedUtr,
        senderName,
        timestamp: Date.now()
      });
      console.log(`[TELEGRAM-PARTIAL] Saved partial UTR ${detectedUtr} for chat ${chatKey}. Waiting for payment SMS...`);
      recordIncomingMessage({
        sender: senderName,
        chatId: chatId || "",
        text,
        parsed: false,
        reason: `12-digit UTR ${detectedUtr} saved. Waiting for amount SMS.`
      });
      if (chatId) {
        await sendTelegramReply(
          token,
          chatId,
          `⏳ <b>12-digit UTR Detected:</b> <code>${detectedUtr}</code>\n\n` +
          `Waiting for payment amount SMS. Forward the bank notification or send the amount (e.g. ₹100).`
        );
      }
      return { success: true, reason: "Partial UTR saved" };
    }
  } else if (!parsed.isValid && parsed.reason === "No 12-digit UTR found") {
    const amountOnly = extractAmountOnly(text);
    const bankOnly = extractBankOnly(text, senderName);
    if (amountOnly > 0) {
      if (isPendingValid && pending.utr) {
        console.log(`[TELEGRAM-STITCH] Merging amount ₹${amountOnly} with pending UTR ${pending.utr} from chat ${chatKey}`);
        parsed = {
          utr: pending.utr,
          amount: amountOnly,
          bank: bankOnly,
          isValid: true
        };
        partialMessageByChat.delete(chatKey);
      } else {
        partialMessageByChat.set(chatKey, {
          amount: amountOnly,
          bank: bankOnly,
          rawText: text,
          senderName,
          timestamp: Date.now()
        });
        console.log(`[TELEGRAM-PARTIAL] Saved partial Amount ₹${amountOnly} (${bankOnly}) for chat ${chatKey}. Waiting for 12-digit UTR...`);
        recordIncomingMessage({
          sender: senderName,
          chatId: chatId || "",
          text,
          parsed: false,
          reason: `Amount ₹${amountOnly} saved. Waiting for 12-digit UTR.`
        });
        if (chatId) {
          await sendTelegramReply(
            token,
            chatId,
            `⏳ <b>Payment Amount Detected:</b> ₹${amountOnly} (${bankOnly})\n\n` +
            `Please forward or type the <b>12-digit UPI UTR number</b> to complete and add to website.`
          );
        }
        return { success: true, reason: "Partial Amount saved" };
      }
    }
  }

  if (parsed.isValid && parsed.utr && parsed.amount > 0) {
    partialMessageByChat.delete(chatKey);
    const result = addBankAlert({
      utr: parsed.utr,
      amount: parsed.amount,
      senderBank: parsed.bank,
      rawText: text
    });

    recordIncomingMessage({
      sender: senderName,
      chatId: chatId || "",
      text,
      parsed: true,
      utr: parsed.utr,
      amount: parsed.amount,
      bank: parsed.bank
    });

    if (result.success && result.alert) {
      console.log(`[TELEGRAM-SMS-SAVED] UTR: ${parsed.utr}, Amount: ₹${parsed.amount}, Bank: ${parsed.bank}`);
      await sendTelegramReply(
        token,
        chatId,
        `✅ <b>Payment Alert Captured on Website!</b>\n\n` +
        `💰 <b>Amount:</b> ₹${parsed.amount}\n` +
        `🔢 <b>UTR / Ref:</b> <code>${parsed.utr}</code>\n` +
        `🏦 <b>Bank:</b> ${parsed.bank}\n` +
        `🟢 <b>Status:</b> Added to website database & ready for instant wallet claim.`
      );
      return { success: true, alert: result.alert, parsed };
    } else if (result.duplicate) {
      console.log(`[TELEGRAM-SMS-DUPLICATE] UTR: ${parsed.utr} already exists.`);
      await sendTelegramReply(
        token,
        chatId,
        `ℹ️ <b>Duplicate SMS:</b> UTR <code>${parsed.utr}</code> (₹${parsed.amount}) is already recorded in the website database.`
      );
      return { success: true, duplicate: true, parsed };
    }
  } else {
    console.log(`[TELEGRAM-SMS-PARSE-FAIL] Reason: ${parsed.reason} | Text: "${text.slice(0, 80)}"`);
    recordIncomingMessage({
      sender: senderName,
      chatId: chatId || "",
      text,
      parsed: false,
      reason: parsed.reason || "Missing 12-digit UTR or amount"
    });

    if (chatId) {
      await sendTelegramReply(
        token,
        chatId,
        `⚠️ <b>Payment details not detected:</b>\n` +
        `${parsed.reason || "Could not detect 12-digit UTR or amount."}\n\n` +
        `<i>Make sure the message contains:</i>\n` +
        `1. 12-digit UPI UTR / Ref No (e.g. 426819284918)\n` +
        `2. Amount (e.g. ₹100 or Rs. 100)`
      );
    }
    return { success: false, reason: parsed.reason, parsed };
  }

  return { success: false };
}

/**
 * Telegram Long-Polling Loop with Fetch, Watchdog & Strict Epoch Cancellation
 */
export async function startTelegramPolling(): Promise<{ success: boolean; message: string }> {
  const token = memoryConfig.botToken.replace(/\s+/g, "").trim();
  if (!token) {
    return { success: false, message: "Bot token is missing. Please provide a valid Telegram Bot Token from @BotFather." };
  }

  // Cancel any running loops by incrementing epoch and aborting previous controller
  currentLoopEpoch++;
  const thisEpoch = currentLoopEpoch;

  if (pollingAbortController) {
    try { pollingAbortController.abort(); } catch {}
    pollingAbortController = null;
  }
  isPolling = false;

  // Verify token via getMe
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      headers: { "Connection": "close" },
      signal: controller.signal
    });
    clearTimeout(t);
    const meData: any = await meRes.json().catch(() => ({}));

    if (!meData || !meData.ok) {
      const errMsg = meData?.description || "Invalid Telegram Bot Token";
      saveTelegramConfig({ lastError: errMsg });
      return { success: false, message: `Telegram Error: ${errMsg}. Please verify your bot token with @BotFather.` };
    }
    const botUser = meData.result?.username || "";
    console.log(`[TELEGRAM-SERVICE] Bot authenticated successfully as @${botUser}`);
    saveTelegramConfig({
      lastError: undefined,
      botUsername: botUser
    });
  } catch (netErr: any) {
    const msg = netErr.message || "Failed to reach Telegram API";
    saveTelegramConfig({ lastError: msg });
    return { success: false, message: msg };
  }

  // Clear any active webhook so Telegram getUpdates works cleanly
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connection": "close" },
      body: JSON.stringify({ drop_pending_updates: false }),
      signal: controller.signal
    });
    clearTimeout(t);
    console.log("[TELEGRAM-SERVICE] Telegram webhook cleared successfully for polling.");
  } catch (delErr: any) {
    console.warn("[TELEGRAM-SERVICE] deleteWebhook notice:", delErr.message);
  }

  isPolling = true;
  lastSuccessfulPollTime = Date.now();
  saveTelegramConfig({
    enabled: true,
    startedAt: new Date().toISOString(),
    lastPolledAt: new Date().toISOString(),
    lastError: undefined,
    mode: "polling"
  });

  pollingAbortController = new AbortController();

  // Polling loop with strictly 1 active loop per epoch
  (async () => {
    console.log(`[TELEGRAM-SERVICE] Telegram polling loop started (epoch: ${thisEpoch}) with native fetch.`);
    let consecutiveErrors = 0;

    while (isPolling && thisEpoch === currentLoopEpoch) {
      try {
        const offset = (memoryConfig.lastUpdateId || 0) + 1;
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=8&allowed_updates=["message","channel_post","edited_message","business_message"]`;

        const reqAbort = new AbortController();
        const pollTimer = setTimeout(() => {
          try { reqAbort.abort(); } catch {}
        }, 12000);

        let resJson: any = null;
        try {
          const resp = await fetch(url, {
            method: "GET",
            headers: { "Connection": "close" },
            signal: reqAbort.signal
          });
          clearTimeout(pollTimer);

          if (resp.ok) {
            resJson = await resp.json();
          } else {
            const errBody: any = await resp.json().catch(() => ({}));
            throw new Error(errBody?.description || `HTTP ${resp.status}`);
          }
        } finally {
          clearTimeout(pollTimer);
        }

        if (thisEpoch !== currentLoopEpoch || !isPolling) break;

        consecutiveErrors = 0;
        lastSuccessfulPollTime = Date.now();
        saveTelegramConfig({ lastPolledAt: new Date().toISOString(), lastError: undefined });

        if (resJson && resJson.ok && Array.isArray(resJson.result)) {
          const updates = resJson.result;

          for (const update of updates) {
            if (update.update_id > (memoryConfig.lastUpdateId || 0)) {
              memoryConfig.lastUpdateId = update.update_id;
              saveTelegramConfig({ lastUpdateId: update.update_id });
            }

            // Process via unified pipeline
            await processTelegramUpdate(update, token);
          }
        }
      } catch (err: any) {
        if (!isPolling || thisEpoch !== currentLoopEpoch) break;

        const errMsg = err.message || "Polling error";

        // Abort errors from normal timeout are benign
        if (err.name === "AbortError" || errMsg.includes("aborted")) {
          lastSuccessfulPollTime = Date.now();
          saveTelegramConfig({ lastPolledAt: new Date().toISOString(), lastError: undefined });
          continue;
        }

        consecutiveErrors++;
        console.warn(`[TELEGRAM-POLL-NOTICE] #${consecutiveErrors}:`, errMsg);

        // Auto-heal 409 Conflict: wait 4 seconds before retrying so stale connection closes
        if (errMsg && (errMsg.toLowerCase().includes("deletewebhook") || errMsg.toLowerCase().includes("conflict"))) {
          console.log("[TELEGRAM-SERVICE] 409 Conflict detected. Deleting webhook & waiting 4s...");
          try {
            await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Connection": "close" },
              body: JSON.stringify({ drop_pending_updates: false })
            });
          } catch {}
          saveTelegramConfig({ lastError: "Conflict: Waiting for other connection to close..." });
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }

        saveTelegramConfig({ lastError: errMsg });

        const sleepMs = Math.min(2000 * consecutiveErrors, 10000);
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }

    console.log(`[TELEGRAM-SERVICE] Telegram polling loop terminated (epoch: ${thisEpoch}).`);
  })();

  // Setup Watchdog to prevent loop stalls
  if (!watchdogInterval) {
    watchdogInterval = setInterval(() => {
      if (isPolling && memoryConfig.mode !== "webhook") {
        const inactiveMs = Date.now() - lastSuccessfulPollTime;
        if (inactiveMs > 35000) {
          console.warn(`[TELEGRAM-WATCHDOG] Polling loop inactive for ${Math.round(inactiveMs / 1000)}s. Reviving...`);
          try {
            pollingAbortController?.abort();
          } catch {}
          startTelegramPolling().catch((e) => console.error("[WATCHDOG-RESTART-ERROR]", e.message));
        }
      }
    }, 15000);
  }

  return { success: true, message: "Telegram bot polling started successfully." };
}

export async function clearTelegramWebhook(token?: string): Promise<{ success: boolean; message: string }> {
  const activeToken = (token || memoryConfig.botToken || "").replace(/\s+/g, "").trim();
  if (!activeToken) {
    return { success: false, message: "No bot token provided." };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${activeToken}/deleteWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connection": "close" },
      body: JSON.stringify({ drop_pending_updates: false })
    });
    const data: any = await res.json().catch(() => ({}));
    if (data?.ok) {
      saveTelegramConfig({ lastError: undefined, mode: "polling" });
      return { success: true, message: "Webhook deleted successfully! Bot can now use getUpdates polling." };
    }
    return { success: false, message: data?.description || "Failed to delete webhook" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function setTelegramWebhook(webhookUrl: string, token?: string): Promise<{ success: boolean; message: string }> {
  const activeToken = (token || memoryConfig.botToken || "").replace(/\s+/g, "").trim();
  if (!activeToken) {
    return { success: false, message: "No bot token provided." };
  }
  if (!webhookUrl || !webhookUrl.startsWith("https://")) {
    return { success: false, message: "Webhook URL must be a valid HTTPS URL." };
  }

  // Stop polling first so webhook takes over cleanly
  stopTelegramPolling();

  try {
    const res = await fetch(`https://api.telegram.org/bot${activeToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Connection": "close" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "channel_post", "edited_message", "business_message"],
        drop_pending_updates: false
      })
    });
    const data: any = await res.json().catch(() => ({}));
    if (data?.ok) {
      saveTelegramConfig({
        mode: "webhook",
        webhookUrl,
        lastError: undefined,
        enabled: true
      });
      console.log(`[TELEGRAM-SERVICE] Webhook set successfully to ${webhookUrl}`);
      return { success: true, message: `Webhook set successfully to ${webhookUrl}! Telegram will now push SMS instantly to your website.` };
    }
    return { success: false, message: data?.description || "Failed to set webhook." };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export async function getTelegramWebhookInfo(token?: string): Promise<{ success: boolean; info?: any; message?: string }> {
  const activeToken = (token || memoryConfig.botToken || "").replace(/\s+/g, "").trim();
  if (!activeToken) {
    return { success: false, message: "No bot token provided." };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${activeToken}/getWebhookInfo`);
    const data: any = await res.json().catch(() => ({}));
    if (data?.ok) {
      return { success: true, info: data.result };
    }
    return { success: false, message: data?.description || "Failed to fetch webhook info." };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

export function stopTelegramPolling(): { success: boolean; message: string } {
  currentLoopEpoch++;
  isPolling = false;
  if (pollingAbortController) {
    try {
      pollingAbortController.abort();
    } catch (e) {}
    pollingAbortController = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
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

  const lastPolledAgeSeconds = memoryConfig.lastPolledAt 
    ? Math.max(0, Math.round((Date.now() - new Date(memoryConfig.lastPolledAt).getTime()) / 1000))
    : null;

  return {
    running: isPolling,
    enabled: memoryConfig.enabled,
    hasToken: !!rawToken,
    maskedToken,
    botUsername: memoryConfig.botUsername || "",
    chatId: memoryConfig.chatId || "",
    upiId: memoryConfig.upiId || "paytmqr281005050101111956557626@paytm",
    payeeName: memoryConfig.payeeName || "Pyare SMM Panel",
    startedAt: memoryConfig.startedAt,
    lastPolledAt: memoryConfig.lastPolledAt,
    lastPolledAgeSeconds,
    lastError: memoryConfig.lastError,
    totalAlertsCount: totalAlerts,
    unusedAlertsCount: unusedAlerts,
    totalIntentsCount: memoryIntents.size,
    recentMessages: memoryRawMessages
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
