import axios from "axios";
import { createClient } from "@libsql/client/web";

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

const DEFAULT_BOT_TOKEN = "8268916986:AAGn5qnLukLpZGw9h9y1kcRzySd_2bS57k0";
const AUTHORIZED_CHAT_ID = "-1004483507103";

function getTurso() {
  try {
    return createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  } catch (e) {
    return null;
  }
}

/**
 * Robust Indian Bank / UPI SMS Parser
 */
function parseBankSms(rawText: string, senderName = "SMS Forwarder") {
  const text = String(rawText || "").trim();
  if (!text) return { utr: "", amount: 0, bank: "Unknown", isValid: false };

  // 1. Ignore pure debit messages unless credit keywords present
  const isExplicitDebit = /\b(debited\s+from|money\s+debited|debited\s+by|sent\s+to\s+[a-zA-Z]|paid\s+to\s+(?!you\b)[a-zA-Z]|withdrawn\s+from)\b/i.test(text);
  const isCredit = /\b(paid\s+you|paid|credited|credit|received|deposit|deposited|added|cr\.?|jama|prapt|transferred\s+to\s+your|transferred\s+from|transfer\s+from|payment\s+received|money\s+received|received\s+rs|rcvd\s+rs|rcvd|payment\s+of)\b/i.test(text);
  if (isExplicitDebit && !isCredit) {
    return { utr: "", amount: 0, bank: "Unknown", isValid: false, reason: "Debit message ignored" };
  }

  // 2. Extract 12-digit UTR / RRN
  let utr = "";
  const labelledPatterns = [
    /(?:upi\s*ref(?:\s*no|\s*id)?|ref(?:\s*no|\s*id)?|utr(?:\s*no|\s*id)?|rrn|txn\s*id|txnid|upi\s*id|reference\s*(?:no|num)?|upi\/|upi:\s*)[\s:/-]*([0-9]{12})\b/i,
    /(?:imps|neft|rtgs|cms)[\s:/-]*([0-9]{12})\b/i,
    /\b([0-9]{12})\b/
  ];
  for (const pat of labelledPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      utr = m[1];
      break;
    }
  }

  // 3. Extract Amount in INR
  let amount = 0;
  const amountPatterns = [
    /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i,
    /(?:paid(?:\s+you)?|credited|received|deposited|deposit|added|payment\s+of|amt|amount)\s*(?:by|with|for|of|is|:)?\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
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

  if (!amount || amount <= 0) {
    const remainingText = utr ? text.replace(new RegExp(utr, "g"), " ") : text;
    const genericMatches = remainingText.match(/\b([1-9][0-9]{0,5}(?:\.[0-9]{1,2})?)\b/g);
    if (genericMatches) {
      for (const numStr of genericMatches) {
        const num = parseFloat(numStr);
        if (num >= 1 && num <= 200000 && num !== 2024 && num !== 2025 && num !== 2026 && num !== 2027) {
          amount = num;
          break;
        }
      }
    }
  }

  // 4. Extract Bank Name
  let bank = "UPI Payment";
  const upper = `${text} ${senderName}`.toUpperCase();
  if (upper.includes("SBI") || upper.includes("STATE BANK")) bank = "State Bank of India (SBI)";
  else if (upper.includes("CENTBK") || upper.includes("CENTRAL BANK") || upper.includes("CBOI")) bank = "Central Bank of India";
  else if (upper.includes("HDFC")) bank = "HDFC Bank";
  else if (upper.includes("ICICI")) bank = "ICICI Bank";
  else if (upper.includes("PAYTM") || upper.includes("PYTM")) bank = "Paytm Payments Bank";
  else if (upper.includes("PHONEPE")) bank = "PhonePe UPI";
  else if (upper.includes("GPAY") || upper.includes("GOOGLE PAY")) bank = "Google Pay";
  else if (upper.includes("AXIS")) bank = "Axis Bank";
  else if (upper.includes("KOTAK")) bank = "Kotak Mahindra Bank";
  else if (upper.includes("BOB") || upper.includes("BARODA")) bank = "Bank of Baroda";
  else if (upper.includes("PNB") || upper.includes("PUNJAB")) bank = "Punjab National Bank";
  else if (upper.includes("CANARA")) bank = "Canara Bank";
  else if (upper.includes("UNION")) bank = "Union Bank of India";
  else if (upper.includes("INDUSIND")) bank = "IndusInd Bank";
  else if (upper.includes("AIRTEL")) bank = "Airtel Payments Bank";

  return {
    utr,
    amount,
    bank,
    isValid: !!(utr && utr.length === 12 && amount > 0)
  };
}

async function sendTelegramReply(token: string, chatId: string | number, text: string) {
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML"
    }, { timeout: 5000 });
  } catch (e: any) {
    console.warn("[TG-REPLY-ERR]", e.message);
  }
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  const reqOrigin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", reqOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, status: "Telegram Webhook Active", domain: "pyaresmmpanel.online" });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    const msg = body.message || body.channel_post || body.edited_message || body.business_message;
    if (!msg) {
      return res.status(200).json({ ok: true, reason: "No message payload" });
    }

    const text = String(msg.text || msg.caption || "").trim();
    const chatId = msg.chat?.id;
    const incomingChatId = chatId ? String(chatId).trim() : "";
    const senderName = msg.from
      ? `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim() || msg.from.username || "User"
      : (msg.chat?.title || "Channel/Group");

    const token = DEFAULT_BOT_TOKEN;

    // Handle bot commands
    if (text === "/start" || text === "/status" || text.startsWith("/start ") || text === "/help") {
      if (incomingChatId) {
        await sendTelegramReply(
          token,
          incomingChatId,
          `🤖 <b>Pyare SMM Panel Payment Bot is Active!</b>\n\n` +
          `✅ <b>Status:</b> Connected & Listening on custom domain (pyaresmmpanel.online)\n` +
          `Chat ID: <code>${incomingChatId}</code>\n\n` +
          `<i>Forward any UPI or Indian Bank SMS here. The 12-digit UTR and amount will be captured and credited to the user's wallet automatically!</i>`
        );
      }
      return res.status(200).json({ ok: true });
    }

    // Ignore bot's own status replies to prevent infinite loops
    if (
      text.includes("Pyare SMM Panel Payment Bot") ||
      text.includes("Payment Alert Captured on Website") ||
      text.includes("Payment Verified & Credited") ||
      text.includes("[New Deposit QR Generated]") ||
      text.includes("Payment Verified Instantly")
    ) {
      return res.status(200).json({ ok: true });
    }

    console.log(`[TG-SMS-IN] From: ${senderName} (${incomingChatId}): "${text.replace(/\n/g, " ")}"`);

    const parsed = parseBankSms(text, senderName);

    if (parsed.isValid && parsed.utr && parsed.amount > 0) {
      const cleanUtr = parsed.utr;
      const amount = parsed.amount;
      const bank = parsed.bank;
      const nowIso = new Date().toISOString();

      console.log(`[PARSED-ALERT] UTR: ${cleanUtr} | Amount: ₹${amount} | Bank: ${bank}`);

      const alertRecord = {
        id: `alert_${cleanUtr}_${Date.now()}`,
        utr: cleanUtr,
        amount,
        senderBank: bank,
        rawText: text,
        timestamp: nowIso,
        isUsed: false,
        status: "available"
      };

      const alertDataJson = JSON.stringify(alertRecord);

      // Save directly to Turso Database
      const client = getTurso();
      if (client) {
        await client.execute({
          sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
                VALUES ('bank_alerts', ?, ?, ?)
                ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
          args: [cleanUtr, alertDataJson, nowIso]
        }).catch(err => console.warn("[TURSO-ALERT-INSERT-ERR]", err.message));

        await client.execute({
          sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
                VALUES ('sms_forwarder_pool', ?, ?, ?)
                ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
          args: [cleanUtr, alertDataJson, nowIso]
        }).catch(() => {});

        // Check if any user was waiting in payment_intents for this UTR or amount
        try {
          const intentRes = await client.execute({
            sql: `SELECT id, data FROM smm_documents WHERE collection = 'payment_intents' LIMIT 100;`
          });
          for (const row of intentRes.rows) {
            let iData: any = {};
            try { iData = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch (e) {}
            if (
              iData &&
              iData.status === "pending" &&
              (iData.orderRef === cleanUtr || (Math.abs(Number(iData.amount || 0) - amount) <= 0.05 && iData.userId))
            ) {
              const uId = String(iData.userId || "");
              console.log(`[AUTO-MATCH-INTENT] Matched UTR ${cleanUtr} with user ${uId}`);

              // 1. Fetch current balance from smm_users table
              const uRes = await client.execute({
                sql: `SELECT balance, data FROM smm_users WHERE id = ? LIMIT 1;`,
                args: [uId]
              });
              let curBal = 0;
              let uData: any = {};
              if (uRes.rows.length > 0) {
                curBal = Number(uRes.rows[0].balance || 0);
                try { uData = typeof uRes.rows[0].data === "string" ? JSON.parse(uRes.rows[0].data) : uRes.rows[0].data; } catch (e) {}
              }
              const newBal = Number((curBal + amount).toFixed(2));

              // 2. Direct SQL UPDATE on smm_users in Turso!
              uData.balance = newBal;
              await client.execute({
                sql: `UPDATE smm_users SET balance = ?, data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
                args: [newBal, JSON.stringify(uData), uId]
              });

              // 3. Insert into smm_deposits table
              const depId = `dep_${cleanUtr}_${Date.now()}`;
              const depObj = {
                id: depId,
                userId: uId,
                userEmail: iData.userEmail || "",
                amount,
                utr: cleanUtr,
                status: "approved",
                method: "Instant UPI QR",
                gateway: bank,
                createdAt: nowIso
              };
              await client.execute({
                sql: `INSERT INTO smm_deposits (id, user_id, amount, status, transaction_id, data, created_at)
                      VALUES (?, ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP);`,
                args: [depId, uId, amount, cleanUtr, JSON.stringify(depObj)]
              }).catch(() => {});

              // 4. Mark intent completed
              iData.status = "completed";
              iData.utr = cleanUtr;
              iData.creditedAmount = amount;
              iData.completedAt = Date.now();
              await client.execute({
                sql: `UPDATE smm_documents SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE collection = 'payment_intents' AND id = ?;`,
                args: [JSON.stringify(iData), String(row.id)]
              }).catch(() => {});

              // 5. Mark alert claimed
              alertRecord.isUsed = true;
              alertRecord.status = "claimed";
              await client.execute({
                sql: `UPDATE smm_documents SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE collection = 'bank_alerts' AND id = ?;`,
                args: [JSON.stringify({ ...alertRecord, usedBy: uId, usedAt: nowIso }), cleanUtr]
              }).catch(() => {});

              // Send Telegram confirmation
              if (incomingChatId) {
                await sendTelegramReply(
                  token,
                  incomingChatId,
                  `🎉 <b>Payment Auto-Verified & Credited!</b>\n` +
                  `💰 <b>Amount:</b> ₹${amount.toFixed(2)}\n` +
                  `🔢 <b>UTR:</b> <code>${cleanUtr}</code>\n` +
                  `👤 <b>User:</b> ${iData.userEmail || uId}\n` +
                  `💵 <b>New Wallet Balance:</b> ₹${newBal.toFixed(2)}\n` +
                  `🏦 <b>Bank:</b> ${bank}`
                );
              }
              return res.status(200).json({ ok: true, matched: true, userId: uId, amount });
            }
          }
        } catch (matchErr: any) {
          console.warn("[INTENT-MATCH-WARN]", matchErr.message);
        }
      }

      // Send confirmation to chat that alert is recorded on website
      if (incomingChatId) {
        await sendTelegramReply(
          token,
          incomingChatId,
          `✅ <b>Payment Alert Captured on Website!</b>\n\n` +
          `💰 <b>Amount:</b> ₹${amount.toFixed(2)}\n` +
          `🔢 <b>12-Digit UTR:</b> <code>${cleanUtr}</code>\n` +
          `🏦 <b>Bank:</b> ${bank}\n` +
          `⏳ <b>Status:</b> Ready to verify! As soon as user enters this UTR on website, balance will credit instantly.`
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[TG-WEBHOOK-FATAL]", err.message);
    return res.status(200).json({ ok: true });
  }
}
