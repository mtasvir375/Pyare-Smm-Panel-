import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function unwrapFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
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

function wrapFirestoreFields(obj: any): any {
  if (!obj || typeof obj !== "object") return {};
  const fields: any = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof val === "string") {
      fields[key] = { stringValue: val };
    } else if (typeof val === "boolean") {
      fields[key] = { booleanValue: val };
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        fields[key] = { integerValue: val.toString() };
      } else {
        fields[key] = { doubleValue: val };
      }
    } else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === "string") return { stringValue: item };
            if (typeof item === "number") return Number.isInteger(item) ? { integerValue: item.toString() } : { doubleValue: item };
            if (typeof item === "boolean") return { booleanValue: item };
            if (typeof item === "object" && item) return { mapValue: { fields: wrapFirestoreFields(item) } };
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
    const res = await axios.get(url, { timeout: 7000 });
    return res.data ? unwrapFirestoreFields(res.data.fields) : null;
  } catch (err: any) {
    if (err.response && err.response.status === 404) return null;
    return null;
  }
}

async function setRestDoc(collection: string, docId: string, data: any): Promise<any> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    const fields = wrapFirestoreFields(data);
    const res = await axios.patch(url, { fields }, { timeout: 8000 });
    return res.data ? unwrapFirestoreFields(res.data.fields) : null;
  } catch (err: any) {
    console.warn(`[REST-SET-ERR] ${collection}/${docId}:`, err.message);
    return null;
  }
}

async function deleteRestDoc(collection: string, docId: string): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_API_KEY}`;
    await axios.delete(url, { timeout: 7000 });
    return true;
  } catch (err: any) {
    return false;
  }
}

function parseBankSms(smsText: string) {
  if (!smsText || typeof smsText !== "string") return null;
  const cleanText = smsText.replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
  const lower = cleanText.toLowerCase();

  // Explicit debits check
  const isDebit = (
    lower.includes("debited") || 
    lower.includes("spent") || 
    lower.includes("withdrawn") || 
    lower.includes("sent to") ||
    (lower.includes("paid to") && !lower.includes("paid you")) ||
    lower.includes("debited from")
  ) && !lower.includes("credited") && !lower.includes("received") && !lower.includes("paid you");

  if (isDebit) {
    return { isCredit: false, reason: "Debit transaction ignored", utr: "", amount: 0, valid: false };
  }

  // Acceptance check
  const isCredit = 
    lower.includes("paid you") ||
    lower.includes("paid") ||
    lower.includes("credit") || 
    lower.includes("received") || 
    lower.includes("deposited") || 
    lower.includes("added to") ||
    lower.includes("sent you") ||
    lower.includes("payment of rs") ||
    lower.includes("payment of inr") ||
    lower.includes("payment of ₹") ||
    lower.includes("prapt") ||
    lower.includes("jama") ||
    lower.includes("transferred to") ||
    lower.includes("transfer from") ||
    lower.includes("upi");

  // Amount extraction
  let amount = 0;
  const amtPatterns = [
    /(?:rs\.?|inr|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
    /(?:credited\s*(?:by|with)?|received|deposited|payment of)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i
  ];

  for (const pat of amtPatterns) {
    const match = cleanText.match(pat);
    if (match && match[1]) {
      const parsed = parseFloat(match[1]);
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // 12-digit UTR
  let utr = "";
  const specificUtrPatterns = [
    /(?:upi\s*ref(?:\s*no|\s*id)?|ref(?:\s*no|\s*id)?|utr(?:\s*no|\s*id)?|rrn|upi\s*txn\s*id)[\s:/-]*([0-9]{12})\b/i,
    /upi[\/:][\s]*([0-9]{12})\b/i,
    /(?:upi\/|ref\s*#?|utr\s*#?)([0-9]{12})\b/i,
    /\b([0-9]{12})\b/
  ];

  for (const pat of specificUtrPatterns) {
    const match = cleanText.match(pat);
    if (match && match[1]) {
      utr = match[1];
      break;
    }
  }

  return {
    isCredit: isCredit || (amount > 0 && utr.length === 12),
    amount,
    utr,
    valid: amount > 0 && utr.length === 12
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-sms-secret");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      body = body.toString("utf-8");
    }

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = { message: body };
      }
    }

    body = body || {};
    const query = req.query || {};

    let smsText = String(
      body.text || body.message || body.body || body.sms || body.content || body.msg || body.raw || body.textMessage ||
      body.msg_body || body.sms_body || body.data ||
      query.text || query.message || query.body || query.sms || query.msg || ""
    ).trim();

    if (!smsText && typeof body === "object") {
      for (const val of Object.values(body)) {
        if (typeof val === "string" && val.length > 5) {
          smsText = val.trim();
          break;
        }
      }
    }

    const sender = String(
      body.from || body.sender || body.address || body.phone || body.number || body.originatingAddress ||
      query.from || query.sender || "SMS_APP"
    ).trim();

    if (!smsText) {
      return res.status(200).json({
        success: true,
        message: "SMS Webhook is live and ready. Send POST with text/message in JSON body."
      });
    }

    const parsed = parseBankSms(smsText);
    const nowIso = new Date().toISOString();
    const logId = `sms_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Save log to Firestore
    await setRestDoc("sms_forwarder_logs", logId, {
      id: logId,
      timestamp: nowIso,
      sender,
      rawText: smsText,
      isCredit: !!parsed?.isCredit,
      amount: parsed?.amount || 0,
      utr: parsed?.utr || "",
      valid: !!parsed?.valid,
      status: parsed?.valid ? "available" : "invalid"
    });

    if (!parsed || !parsed.valid || !parsed.utr || parsed.amount <= 0) {
      return res.status(200).json({
        success: true,
        captured: false,
        message: "SMS received but 12-digit UTR or Amount was not found.",
        parsed
      });
    }

    const cleanUtr = parsed.utr;
    const amount = parsed.amount;

    // Check if user is waiting in pending_user_utrs
    let autoCredited = false;
    let waitingUser: any = await getRestDoc("pending_user_utrs", cleanUtr);

    if (waitingUser && waitingUser.userId) {
      try {
        const userDoc = await getRestDoc("users", waitingUser.userId);
        const currentBal = Number(userDoc?.balance || 0);
        const newBalance = currentBal + amount;

        await setRestDoc("users", waitingUser.userId, { balance: newBalance });

        const depositId = `dep_auto_${cleanUtr}`;
        await setRestDoc("deposits", depositId, {
          userId: waitingUser.userId,
          userEmail: waitingUser.userEmail || "",
          amount,
          utr: cleanUtr,
          status: "approved",
          paymentMethod: "sms_forwarder_auto",
          createdAt: nowIso,
          verifiedAt: nowIso
        });

        await deleteRestDoc("pending_user_utrs", cleanUtr);
        autoCredited = true;
      } catch (creditErr: any) {
        console.error("[SMS-AUTO-CREDIT-ERR]", creditErr.message);
      }
    }

    // Save to sms_forwarder_pool in Firestore
    await setRestDoc("sms_forwarder_pool", cleanUtr, {
      utr: cleanUtr,
      amount,
      sender,
      rawSms: smsText,
      timestamp: nowIso,
      status: autoCredited ? "claimed" : "available",
      claimedBy: autoCredited ? (waitingUser?.userId || "") : "",
      claimedEmail: autoCredited ? (waitingUser?.userEmail || "") : "",
      claimedAt: autoCredited ? nowIso : null
    });

    return res.status(200).json({
      success: true,
      captured: true,
      message: autoCredited
        ? `₹${amount} (UTR: ${cleanUtr}) auto-credited to waiting user!`
        : `₹${amount} (UTR: ${cleanUtr}) saved and ready for instant user claim.`,
      utr: cleanUtr,
      amount,
      autoCredited
    });
  } catch (err: any) {
    console.error("[SMS-WEBHOOK-FATAL]", err.message);
    return res.status(200).json({ success: false, error: err.message });
  }
}
