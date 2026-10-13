import axios from "axios";
import { createClient } from "@libsql/client/web";

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

function getTurso() {
  try {
    return createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  } catch (e) {
    return null;
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
    return res.status(200).json({ ok: true, status: "SMS Forwarder Webhook Active on Pyare SMM Panel" });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) {}
    }
    body = body || {};

    let rawText = "";
    if (typeof body === "string") {
      rawText = body;
    } else if (typeof body === "object") {
      rawText = body.text || body.message || body.body || body.content || body.sms || body.msg || body.data || body.sms_body || body.smsContent || "";
    }
    if (!rawText && req.query) {
      rawText = (req.query.text || req.query.message || req.query.body || req.query.content || req.query.sms || "") as string;
    }

    if (!rawText || typeof rawText !== "string") {
      return res.status(200).json({ success: true, message: "No SMS text provided" });
    }

    // Extract 12-digit UTR
    const utrMatch = rawText.match(/\b([0-9]{12})\b/);
    if (!utrMatch) {
      return res.status(200).json({ success: true, message: "No 12-digit UTR found in SMS" });
    }
    const cleanUtr = utrMatch[1];

    // Extract Amount
    let amount = 0;
    const amountMatch = rawText.match(/(?:rs\.?|inr|₹|amount|paid|credited|received)\s*[:=]?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i);
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(/,/g, ""));
    }
    if (!amount || amount <= 0) {
      const nums = rawText.replace(new RegExp(cleanUtr, "g"), " ").match(/\b([1-9][0-9]{0,5}(?:\.[0-9]{1,2})?)\b/g);
      if (nums) {
        for (const n of nums) {
          const val = parseFloat(n);
          if (val >= 1 && val <= 100000 && val !== 2025 && val !== 2026 && val !== 2027) {
            amount = val;
            break;
          }
        }
      }
    }

    if (!amount || amount <= 0) {
      return res.status(200).json({ success: true, message: "Amount could not be extracted" });
    }

    const nowIso = new Date().toISOString();
    const alertRecord = {
      id: `alert_${cleanUtr}_${Date.now()}`,
      utr: cleanUtr,
      amount,
      senderBank: "SMS Forwarder App",
      rawText,
      timestamp: nowIso,
      isUsed: false,
      status: "available"
    };

    const client = getTurso();
    if (client) {
      const dataStr = JSON.stringify(alertRecord);
      await client.execute({
        sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
              VALUES ('bank_alerts', ?, ?, ?)
              ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
        args: [cleanUtr, dataStr, nowIso]
      }).catch(() => {});

      await client.execute({
        sql: `INSERT INTO smm_documents (collection, id, data, updated_at)
              VALUES ('sms_forwarder_pool', ?, ?, ?)
              ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
        args: [cleanUtr, dataStr, nowIso]
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: "Alert recorded to Turso", utr: cleanUtr, amount });
  } catch (err: any) {
    return res.status(200).json({ ok: true });
  }
}
