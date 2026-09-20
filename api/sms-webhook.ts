import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function parseBankSms(smsText: string) {
  if (!smsText || typeof smsText !== "string") return null;
  const cleanText = smsText.replace(/\r\n/g, " ").replace(/\n/g, " ").trim();
  const lower = cleanText.toLowerCase();

  // Rejection check: Explicit debits
  const isDebit = (
    lower.includes("debited") || 
    lower.includes("spent") || 
    lower.includes("withdrawn") || 
    lower.includes("sent to") ||
    lower.includes("paid to") ||
    lower.includes("purchase of") ||
    lower.includes("transfer to") ||
    lower.includes("debited from")
  ) && !lower.includes("credited") && !lower.includes("received");

  if (isDebit) {
    return { isCredit: false, reason: "Debit transaction ignored" };
  }

  // Acceptance check
  const isCredit = 
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
    lower.includes("has transferred rs") ||
    lower.includes("has transferred inr");

  if (!isCredit) {
    return { isCredit: false, reason: "No payment credit keyword found in message" };
  }

  // Amount extraction
  let amount = 0;
  const amtPatterns = [
    /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /(?:credited\s*(?:by|with)?|received|deposited|payment of)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)/i,
    /([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i
  ];

  for (const pat of amtPatterns) {
    const match = cleanText.match(pat);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(/,/g, ""));
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
    /(?:upi\/|ref\s*#?|utr\s*#?)([0-9]{12})\b/i
  ];

  for (const pat of specificUtrPatterns) {
    const match = cleanText.match(pat);
    if (match && match[1]) {
      utr = match[1];
      break;
    }
  }

  if (!utr) {
    const fallbackMatch = cleanText.match(/\b([0-9]{12})\b/);
    if (fallbackMatch && fallbackMatch[1]) {
      utr = fallbackMatch[1];
    }
  }

  return {
    isCredit: true,
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
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = { message: body };
      }
    }

    const query = req.query || {};

    const smsText = String(
      body.text || body.message || body.body || body.sms || body.content || body.msg || body.raw || body.textMessage ||
      query.text || query.message || query.body || query.sms || ""
    ).trim();

    const sender = String(
      body.from || body.sender || body.address || body.phone || body.number || body.originatingAddress ||
      query.from || query.sender || "SMS_APP"
    ).trim();

    if (!smsText) {
      return res.status(200).json({
        success: true,
        message: "SMS Forwarder webhook endpoint is live on Vercel and ready. Send POST with 'message' or 'text' key."
      });
    }

    const parsed = parseBankSms(smsText);
    const nowIso = new Date().toISOString();
    const logId = `sms_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents`;

    // 1. Save log to Firestore
    try {
      await axios.patch(`${firestoreBase}/sms_forwarder_logs/${logId}?key=${FIREBASE_API_KEY}`, {
        fields: {
          timestamp: { stringValue: nowIso },
          sender: { stringValue: sender },
          rawText: { stringValue: smsText },
          isCredit: { booleanValue: !!parsed?.isCredit },
          amount: { doubleValue: parsed?.amount || 0 },
          utr: { stringValue: parsed?.utr || "" },
          valid: { booleanValue: !!parsed?.valid },
          status: { stringValue: parsed?.valid ? "available" : "invalid" }
        }
      }, { timeout: 5000 });
    } catch (e: any) {
      console.warn("[VERCEL-SMS] Failed to write log:", e.message);
    }

    if (!parsed || !parsed.valid || !parsed.utr || parsed.amount <= 0) {
      return res.status(200).json({
        success: true,
        message: "SMS received but could not detect valid credit amount and 12-digit UTR.",
        parsed
      });
    }

    const cleanUtr = parsed.utr;
    const amount = parsed.amount;

    // 2. Check if a user is waiting for this UTR in pending_user_utrs
    let autoCredited = false;
    let waitingUser: any = null;

    try {
      const pendingRes = await axios.get(`${firestoreBase}/pending_user_utrs/${cleanUtr}?key=${FIREBASE_API_KEY}`, { timeout: 4000 });
      if (pendingRes.data && pendingRes.data.fields) {
        const fields = pendingRes.data.fields;
        waitingUser = {
          userId: fields.userId?.stringValue || "",
          userEmail: fields.userEmail?.stringValue || "",
          amount: fields.amount?.doubleValue || fields.amount?.integerValue || amount
        };
      }
    } catch (e) {}

    if (waitingUser && waitingUser.userId) {
      // Auto-credit user in Firestore
      try {
        // Read current user balance
        const userDocRes = await axios.get(`${firestoreBase}/users/${waitingUser.userId}?key=${FIREBASE_API_KEY}`, { timeout: 4000 });
        const currentBalance = userDocRes.data.fields?.balance?.doubleValue || userDocRes.data.fields?.balance?.integerValue || 0;
        const newBalance = currentBalance + amount;

        // Update balance
        await axios.patch(`${firestoreBase}/users/${waitingUser.userId}?updateMask.fieldPaths=balance&key=${FIREBASE_API_KEY}`, {
          fields: {
            balance: { doubleValue: newBalance }
          }
        }, { timeout: 4000 });

        // Create deposit doc
        const depositId = `dep_auto_${cleanUtr}`;
        await axios.patch(`${firestoreBase}/deposits/${depositId}?key=${FIREBASE_API_KEY}`, {
          fields: {
            userId: { stringValue: waitingUser.userId },
            userEmail: { stringValue: waitingUser.userEmail },
            amount: { doubleValue: amount },
            utr: { stringValue: cleanUtr },
            status: { stringValue: "approved" },
            paymentMethod: { stringValue: "sms_forwarder_auto" },
            createdAt: { stringValue: nowIso },
            verifiedAt: { stringValue: nowIso }
          }
        }, { timeout: 4000 });

        // Delete or mark pending_user_utr claimed
        await axios.delete(`${firestoreBase}/pending_user_utrs/${cleanUtr}?key=${FIREBASE_API_KEY}`, { timeout: 4000 });

        autoCredited = true;
      } catch (creditErr: any) {
        console.error("[VERCEL-SMS-AUTO-ERR]", creditErr.message);
      }
    }

    // 3. Save to sms_forwarder_pool in Firestore
    await axios.patch(`${firestoreBase}/sms_forwarder_pool/${cleanUtr}?key=${FIREBASE_API_KEY}`, {
      fields: {
        utr: { stringValue: cleanUtr },
        amount: { doubleValue: amount },
        sender: { stringValue: sender },
        rawSms: { stringValue: smsText },
        timestamp: { stringValue: nowIso },
        status: { stringValue: autoCredited ? "claimed" : "available" },
        claimedBy: { stringValue: autoCredited ? waitingUser?.userId : "" },
        claimedEmail: { stringValue: autoCredited ? waitingUser?.userEmail : "" }
      }
    }, { timeout: 5000 });

    return res.status(200).json({
      success: true,
      message: autoCredited
        ? `₹${amount} (UTR: ${cleanUtr}) auto-credited to waiting user!`
        : `₹${amount} (UTR: ${cleanUtr}) saved to pool and ready for user verification!`,
      utr: cleanUtr,
      amount,
      autoCredited
    });
  } catch (err: any) {
    console.error("[VERCEL-SMS-WEBHOOK-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
