import axios from "axios";
import { createClient } from "@libsql/client/web";

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL || "libsql://pyare-smm-panel-pyaresmmpanel.aws-ap-south-1.turso.io";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTEwNjQ0NzgsImlkIjoiMDFhMTAzYzEtNzYwMS03NDk5LTljYWMtYzdkMDExOWU5M2ZkIiwia2lkIjoiYVFCV3BPanpQSVA2czQzcGlrZ29pbkJtVlNodDZOTmh0YndUejBpaDRGOCIsInJpZCI6IjM0MTg2ZDIxLTgwYTUtNDU1YS1hOWQ3LWJhNGQzZTJlNTIzYSJ9.MXelOKfVsMZZoYfKiflhegiqqXQD5-0HN_faUU4z7WtQdjiQQTWXpU-i8jF1DiQrRpFUUV5wol-7dikl8pW5Dw";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function getTurso() {
  try {
    return createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  } catch (e) {
    return null;
  }
}

function unwrapFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val === undefined || val === null) continue;
    if (val.stringValue !== undefined) res[key] = val.stringValue;
    else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) res[key] = val.timestampValue;
    else if (val.arrayValue && val.arrayValue.values) {
      res[key] = val.arrayValue.values.map((v: any) => {
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.mapValue) return unwrapFirestoreFields(v.mapValue.fields);
        return v;
      });
    } else if (val.mapValue && val.mapValue.fields) {
      res[key] = unwrapFirestoreFields(val.mapValue.fields);
    } else {
      res[key] = null;
    }
  }
  return res;
}

function wrapFirestoreFields(data: any): any {
  const fields: any = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string") {
      fields[key] = { stringValue: val };
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (typeof val === "boolean") {
      fields[key] = { booleanValue: val };
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === "string") return { stringValue: item };
            if (typeof item === "number") {
              return Number.isInteger(item)
                ? { integerValue: item.toString() }
                : { doubleValue: item };
            }
            if (typeof item === "boolean") return { booleanValue: item };
            if (typeof item === "object" && item !== null) {
              return { mapValue: { fields: wrapFirestoreFields(item) } };
            }
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === "object") {
      fields[key] = { mapValue: { fields: wrapFirestoreFields(val) } };
    }
  }
  return fields;
}

async function getRestDoc(collection: string, docId: string): Promise<any> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const res = await axios.get(url, { timeout: 6000 });
    return res.data ? unwrapFirestoreFields(res.data.fields) : null;
  } catch (err: any) {
    return null;
  }
}

async function setRestDoc(collection: string, docId: string, data: any): Promise<any> {
  try {
    const fields = wrapFirestoreFields({ ...data, id: docId });
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const res = await axios.patch(url, { fields }, { timeout: 8000 });
    return res.data ? unwrapFirestoreFields(res.data.fields) : data;
  } catch (patchErr: any) {
    return data;
  }
}

async function creditReferralCommissionInTurso(client: any, userId: string, depositAmount: number, uniqueTxKey: string, depositorHint?: any) {
  if (!userId || depositAmount <= 0 || !uniqueTxKey || !client) return;
  try {
    let referredBy = depositorHint?.referredBy;
    if (!referredBy) {
      const uRes = await client.execute({ sql: `SELECT data FROM smm_users WHERE id = ? LIMIT 1;`, args: [userId] }).catch(() => null);
      if (uRes?.rows?.length && typeof uRes.rows[0].data === "string") {
        try { referredBy = JSON.parse(uRes.rows[0].data)?.referredBy; } catch (e) {}
      }
    }
    if (!referredBy) {
      const regRes = await client.execute({ sql: `SELECT data FROM smm_documents WHERE collection = 'referral_regs' AND id = ? LIMIT 1;`, args: [userId] }).catch(() => null);
      if (regRes?.rows?.length && typeof regRes.rows[0].data === "string") {
        try { referredBy = JSON.parse(regRes.rows[0].data)?.referrerId; } catch (e) {}
      }
    }
    if (!referredBy) {
      const fsDep = await getRestDoc("users", userId).catch(() => null);
      if (fsDep?.referredBy) referredBy = fsDep.referredBy;
    }
    if (!referredBy || referredBy === userId) return;

    let commPercent = 10;
    try {
      let sData: any = null;
      const sRes = await client.execute({ sql: `SELECT value FROM smm_settings WHERE key = 'payment' LIMIT 1;` }).catch(() => null);
      if (sRes?.rows?.length && typeof sRes.rows[0].value === "string") sData = JSON.parse(sRes.rows[0].value);
      if (!sData) sData = await getRestDoc("settings", "payment").catch(() => null);
      if (sData?.referralCommissionPercent !== undefined && !isNaN(Number(sData.referralCommissionPercent))) {
        commPercent = Number(sData.referralCommissionPercent);
      }
    } catch (e) {}

    if (commPercent <= 0) return;
    const commAmount = Number(((depositAmount * commPercent) / 100).toFixed(2));
    if (commAmount <= 0) return;

    let referrerDoc: any = null;
    const rRes = await client.execute({ sql: `SELECT id, email, role, balance, data FROM smm_users WHERE id = ? LIMIT 1;`, args: [referredBy] }).catch(() => null);
    if (rRes?.rows?.length) {
      const row = rRes.rows[0];
      const parsed = typeof row.data === "string" ? JSON.parse(row.data) : (row.data || {});
      referrerDoc = { ...parsed, id: row.id, uid: row.id, email: row.email || parsed.email || "", role: row.role || parsed.role || "student", balance: Number(row.balance ?? parsed.balance ?? 0) };
    }
    if (!referrerDoc) referrerDoc = await getRestDoc("users", referredBy).catch(() => null);
    if (!referrerDoc) return;

    const lockId = `ref_comm_${String(uniqueTxKey).trim()}`;
    const lockRes = await client.execute({
      sql: `INSERT INTO smm_documents (collection, id, data, updated_at) VALUES ('referral_claims', ?, ?, ?) ON CONFLICT(collection, id) DO NOTHING;`,
      args: [lockId, JSON.stringify({ userId, referredBy, depositAmount, commAmount, commPercent, uniqueTxKey, creditedAt: new Date().toISOString() }), new Date().toISOString()]
    }).catch(() => null);
    if (!lockRes || lockRes.rowsAffected === 0) return;

    const nowIso = new Date().toISOString();
    const updatedReferrer = {
      ...referrerDoc,
      id: referredBy,
      uid: referredBy,
      referralBalance: Number((Number(referrerDoc.referralBalance || 0) + commAmount).toFixed(2)),
      referralEarningsTotal: Number((Number(referrerDoc.referralEarningsTotal || 0) + commAmount).toFixed(2)),
      updatedAt: nowIso
    };
    const updatedJson = JSON.stringify(updatedReferrer);
    await client.execute({
      sql: `INSERT INTO smm_users (id, email, role, balance, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET email = COALESCE(NULLIF(excluded.email, ''), smm_users.email), data = excluded.data, updated_at = excluded.updated_at;`,
      args: [referredBy, updatedReferrer.email || "", updatedReferrer.role || "student", Number(updatedReferrer.balance || 0), updatedJson, nowIso]
    }).catch(() => {});
    await client.execute({
      sql: `INSERT INTO smm_documents (collection, id, data, updated_at) VALUES ('users', ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
      args: [referredBy, updatedJson, nowIso]
    }).catch(() => {});
    await setRestDoc("users", referredBy, updatedReferrer).catch(() => {});
  } catch (err) {}
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
    const nowMs = Date.now();
    const alertRecord = {
      id: `alert_${cleanUtr}_${nowMs}`,
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

    await Promise.all([
      setRestDoc("bank_alerts", cleanUtr, alertRecord).catch(() => {}),
      setRestDoc("sms_forwarder_pool", cleanUtr, alertRecord).catch(() => {})
    ]);

    // Check matching intent and auto credit user
    if (client) {
      try {
        const intentRes = await client.execute({
          sql: `SELECT id, data FROM smm_documents WHERE collection = 'payment_intents' ORDER BY updated_at DESC LIMIT 100;`
        });
        for (const row of intentRes.rows) {
          let iData: any = {};
          try { iData = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch (e) {}
          if (iData && iData.status === "pending" && iData.userId) {
            const isMatch = iData.orderRef === cleanUtr || iData.intentId === cleanUtr || (Math.abs(Number(iData.amount || 0) - amount) <= 0.05 && (nowMs - (iData.createdAt || 0) < 3600000));
            if (isMatch) {
              const uId = String(iData.userId);
              // Atomic claim lock in Turso to prevent double crediting
              let claimBlocked = false;
              const lockKeys = Array.from(new Set([cleanUtr, iData.orderRef, iData.intentId].filter(Boolean).map(String)));
              for (const lk of lockKeys) {
                const cRes = await client.execute({
                  sql: `INSERT INTO smm_documents (collection, id, data, updated_at) VALUES ('claimed_payments', ?, ?, ?) ON CONFLICT(collection, id) DO NOTHING;`,
                  args: [lk, JSON.stringify({ orderRef: iData.orderRef || cleanUtr, utr: cleanUtr, userId: uId, amount, credited: true, claimedAt: nowIso }), nowIso]
                }).catch(() => null);
                if (!cRes || cRes.rowsAffected === 0) {
                  claimBlocked = true;
                  break;
                }
              }
              if (claimBlocked) {
                return res.status(200).json({ success: true, alreadyClaimed: true, message: "Already claimed" });
              }

              let curBal = 0;
              let uData: any = {};

              const uRes = await client.execute({ sql: `SELECT balance, data FROM smm_users WHERE id = ? LIMIT 1;`, args: [uId] });
              if (uRes.rows.length > 0) {
                curBal = Number(uRes.rows[0].balance || 0);
                try { uData = typeof uRes.rows[0].data === "string" ? JSON.parse(uRes.rows[0].data) : (uRes.rows[0].data || {}); } catch (e) {}
              }
              const newBal = Number((curBal + amount).toFixed(2));
              const depId = `dep_${cleanUtr}_${nowMs}`;
              const depObj = {
                id: depId,
                userId: uId,
                userEmail: iData.userEmail || uData.email || "",
                amount,
                utr: cleanUtr,
                orderRef: iData.orderRef || cleanUtr,
                status: "approved",
                method: "Instant UPI QR",
                gateway: "SMS Forwarder App",
                createdAt: nowIso
              };
              const existingDeposits = Array.isArray(uData.latestDeposits) ? uData.latestDeposits : [];
              uData.latestDeposits = [depObj, ...existingDeposits.filter((d: any) => d && d.utr !== cleanUtr && d.orderRef !== iData.orderRef)].slice(0, 10);
              uData.balance = newBal;
              uData.updatedAt = nowIso;
              const uJson = JSON.stringify(uData);

              await client.execute({
                sql: `INSERT INTO smm_users (id, email, role, balance, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET balance = excluded.balance, data = excluded.data, updated_at = excluded.updated_at;`,
                args: [uId, uData.email || "", uData.role || "student", newBal, uJson, nowIso]
              });
              await client.execute({
                sql: `INSERT INTO smm_documents (collection, id, data, updated_at) VALUES ('users', ?, ?, ?)
                      ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
                args: [uId, uJson, nowIso]
              });
              await client.execute({
                sql: `INSERT INTO smm_deposits (id, user_id, amount, status, transaction_id, data, created_at)
                      VALUES (?, ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP)
                      ON CONFLICT(id) DO UPDATE SET status = 'approved', data = excluded.data;`,
                args: [depId, uId, amount, cleanUtr, JSON.stringify(depObj)]
              }).catch(() => {});
              await client.execute({
                sql: `INSERT INTO smm_documents (collection, id, data, updated_at) VALUES ('deposits', ?, ?, ?)
                      ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
                args: [depId, JSON.stringify(depObj), nowIso]
              }).catch(() => {});

              iData.status = "completed";
              iData.utr = cleanUtr;
              iData.creditedAmount = amount;
              iData.newBalance = newBal;
              iData.completedAt = nowMs;
              const iJson = JSON.stringify(iData);

              await client.execute({
                sql: `UPDATE smm_documents SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE collection = 'payment_intents' AND id = ?;`,
                args: [iJson, String(row.id)]
              });
              if (iData.orderRef) {
                await client.execute({
                  sql: `UPDATE smm_documents SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE collection = 'payment_intents' AND id = ?;`,
                  args: [iJson, String(iData.orderRef)]
                });
              }

              await setRestDoc("users", uId, uData).catch(() => {});
              await setRestDoc("deposits", depId, depObj).catch(() => {});
              await setRestDoc("payment_intents", iData.intentId, iData).catch(() => {});
              if (iData.orderRef) await setRestDoc("payment_intents", iData.orderRef, iData).catch(() => {});

              await creditReferralCommissionInTurso(client, uId, amount, cleanUtr || depId, uData);

              return res.status(200).json({ success: true, matched: true, userId: uId, amount, newBalance: newBal });
            }
          }
        }
      } catch (e) {}
    }

    return res.status(200).json({ success: true, message: "Alert recorded to Turso", utr: cleanUtr, amount });
  } catch (err: any) {
    return res.status(200).json({ ok: true });
  }
}
