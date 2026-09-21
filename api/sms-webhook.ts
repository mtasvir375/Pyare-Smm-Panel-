import { getRestDoc, setRestDoc, deleteRestDoc } from "./_firestoreRest";

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
    lower.includes("has transferred") ||
    lower.includes("transferred rs") ||
    lower.includes("aaye") ||
    lower.includes("bheje") ||
    lower.includes("khate me") ||
    lower.includes("account") ||
    lower.includes("upi");

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
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      body = body.toString("utf-8");
    }

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // Plain text string
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

    // If still empty, search all keys in body for a string containing numbers or keywords
    if (!smsText && typeof body === "object") {
      for (const val of Object.values(body)) {
        if (typeof val === "string" && val.length > 10) {
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
        message: "SMS Forwarder webhook endpoint is live and ready. Send POST with 'message' or 'text' key."
      });
    }

    const parsed = parseBankSms(smsText);
    const nowIso = new Date().toISOString();
    const logId = `sms_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. Save log to Firestore using REST
    try {
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
    } catch (logErr: any) {
      console.warn("[FIREBASE-SMS] Failed to write log:", logErr.message);
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
      waitingUser = await getRestDoc("pending_user_utrs", cleanUtr);
    } catch (e: any) {
      console.warn("[CHECK-PENDING-ERR]", e.message);
    }

    if (waitingUser && waitingUser.userId) {
      // Auto-credit user in Firestore
      try {
        const userDoc = await getRestDoc("users", waitingUser.userId);
        const currentBal = userDoc?.balance || 0;
        const newBalance = Number(currentBal) + amount;

        await setRestDoc("users", waitingUser.userId, { balance: newBalance });

        // Create deposit doc
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

        // Delete pending_user_utr entry
        await deleteRestDoc("pending_user_utrs", cleanUtr);
        autoCredited = true;
      } catch (creditErr: any) {
        console.error("[SMS-AUTO-CREDIT-ERR]", creditErr.message);
      }
    }

    // 3. Save to sms_forwarder_pool in Firestore
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
      message: autoCredited
        ? `₹${amount} (UTR: ${cleanUtr}) auto-credited to waiting user!`
        : `₹${amount} (UTR: ${cleanUtr}) saved to pool and ready for instant user verification!`,
      utr: cleanUtr,
      amount,
      autoCredited
    });
  } catch (err: any) {
    console.error("[SMS-WEBHOOK-FATAL]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
