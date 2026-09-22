import axios from "axios";
import { getRestDoc, setRestDoc, deleteRestDoc } from "./_firestoreRest";

function parseBankSms(rawText: string, senderName?: string) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  // 1. Detect if debit message (ignore unless clearly credit)
  const isDebit = /\b(debited|spent|withdrawn|sent\s+rs|paid\s+rs|transferred\s+to|debited\s+from)\b/i.test(text);
  const isCredit = /\b(credited|received|deposit|deposited|added|cr\b|payment\s+received|received\s+payment|jama|prapt|transferred\s+rs)\b/i.test(text);
  if (isDebit && !isCredit) {
    return { utr: "", amount: 0, bank: "Unknown", isValid: false, reason: "Debit notification ignored" };
  }

  // 2. Extract 12-digit UTR / RRN
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

async function sendTelegramMessage(botToken: string, chatId: string | number, text: string) {
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
    console.warn("[TELEGRAM-SEND-FAIL]", err.message);
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Quick GET healthcheck
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", message: "Telegram webhook endpoint is active." });
  }

  try {
    const update = req.body || {};
    const message = update.message || update.channel_post || update.edited_message;

    if (!message) {
      return res.status(200).json({ ok: true, note: "No message payload" });
    }

    const chatId = message.chat?.id;
    const text = String(message.text || message.caption || "").trim();

    // Get current telegram bot token from Firestore
    let botToken = "";
    try {
      const cfg = await getRestDoc("settings", "telegram_bot");
      botToken = cfg?.botToken || "";
    } catch (e) {}

    // 1. Handle /start command
    if (text === "/start" || text === "/help") {
      if (botToken && chatId) {
        await sendTelegramMessage(
          botToken,
          chatId,
          `👋 <b>Pyare SMM Panel - Automated UPI Bot</b>\n\n` +
          `Aap is bot me apna Bank ya UPI Payment Confirmation SMS forward karein (PhonePe, Paytm, Google Pay, SBI, HDFC, ICICI, etc.).\n\n` +
          `⚡ <b>Features:</b>\n` +
          `• 12-Digit UTR aur credited amount automatic extract hota hai.\n` +
          `• Website par user jaise hi UTR verify karta hai, balance instantly add ho jata hai!\n\n` +
          `<i>SMS yahan send karke test karein!</i>`
        );
      }
      return res.status(200).json({ ok: true, action: "greeted" });
    }

    // 2. Parse Bank SMS
    const parsed = parseBankSms(text);
    if (!parsed || !parsed.isValid || !parsed.utr || parsed.amount <= 0) {
      // If it's a debit message or invalid SMS
      if (parsed?.reason === "Debit notification ignored" && botToken && chatId) {
        await sendTelegramMessage(botToken, chatId, `⚠️ <b>Transaction Ignored:</b> Ye debit message lag raha hai. Sirf incoming payment credit SMS forward karein.`);
      }
      return res.status(200).json({ ok: true, note: "Not a valid bank credit SMS", parsed });
    }

    const cleanUtr = parsed.utr;
    const amount = parsed.amount;
    const bank = parsed.bank;
    const nowIso = new Date().toISOString();

    // 3. Check if user is already waiting for this UTR in pending_user_utrs
    let autoCredited = false;
    let waitingUser: any = null;
    try {
      waitingUser = await getRestDoc("pending_user_utrs", cleanUtr);
    } catch (e) {}

    if (waitingUser && waitingUser.userId) {
      try {
        const userDoc = await getRestDoc("users", waitingUser.userId);
        const currentBal = Number(userDoc?.balance || 0);
        const newBalance = currentBal + amount;
        await setRestDoc("users", waitingUser.userId, { balance: newBalance });

        const depositId = `dep_tg_${cleanUtr}`;
        await setRestDoc("deposits", depositId, {
          userId: waitingUser.userId,
          userEmail: waitingUser.userEmail || "",
          amount,
          utr: cleanUtr,
          status: "approved",
          paymentMethod: `telegram_${bank}`,
          createdAt: nowIso,
          verifiedAt: nowIso
        });

        await deleteRestDoc("pending_user_utrs", cleanUtr);
        autoCredited = true;
      } catch (creditErr: any) {
        console.error("[TELEGRAM-CREDIT-WAITING-FAIL]", creditErr.message);
      }
    }

    // 4. Save to sms_forwarder_pool & bank_alerts in Firestore
    const alertData = {
      id: `alert_${cleanUtr}_${Date.now()}`,
      utr: cleanUtr,
      amount,
      senderBank: bank,
      rawText: text,
      timestamp: nowIso,
      status: autoCredited ? "claimed" : "available",
      isUsed: autoCredited,
      claimedBy: autoCredited ? (waitingUser?.userId || "") : "",
      claimedEmail: autoCredited ? (waitingUser?.userEmail || "") : "",
      claimedAt: autoCredited ? nowIso : null
    };

    try {
      await setRestDoc("sms_forwarder_pool", cleanUtr, alertData);
      await setRestDoc("bank_alerts", cleanUtr, alertData);
    } catch (saveErr: any) {
      console.warn("[TELEGRAM-SAVE-ALERT-FAIL]", saveErr.message);
    }

    // 5. Send rich receipt to Telegram chat/channel
    if (botToken && chatId) {
      const statusText = autoCredited
        ? `🎉 <b>Auto-Credited to User:</b> ${waitingUser?.userEmail || waitingUser?.userId}`
        : `🟢 <b>Ready & Available for User Claim</b>`;

      const msg =
        `✅ <b>Payment Alert Captured!</b>\n\n` +
        `💰 <b>Amount:</b> ₹${amount}\n` +
        `🔢 <b>UTR / RRN:</b> <code>${cleanUtr}</code>\n` +
        `🏦 <b>Bank:</b> ${bank}\n` +
        `📌 <b>Status:</b> ${statusText}\n` +
        `⏱ <b>Time:</b> ${new Date().toLocaleTimeString("en-IN")}`;

      await sendTelegramMessage(botToken, chatId, msg);
    }

    return res.status(200).json({
      ok: true,
      captured: true,
      utr: cleanUtr,
      amount,
      autoCredited
    });
  } catch (err: any) {
    console.error("[TELEGRAM-WEBHOOK-FATAL]", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
