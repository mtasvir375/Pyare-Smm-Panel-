import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { utr, amount: reqAmount, userEmail, userId: reqUserId, adminEmail } = req.body || {};
    const cleanUtr = String(utr || "").replace(/\D/g, "");
    if (cleanUtr.length !== 12) {
      return res.status(400).json({ error: "Please provide a valid 12-digit UTR" });
    }

    const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents`;
    const nowIso = new Date().toISOString();

    // 1. Check if there's a pending user waiting for this UTR
    let targetUserId = reqUserId || "";
    let targetEmail = userEmail || "";
    let amountToCredit = Number(reqAmount || 0);

    try {
      const pendingRes = await axios.get(`${firestoreBase}/pending_user_utrs/${cleanUtr}?key=${FIREBASE_API_KEY}`, { timeout: 4000 });
      if (pendingRes.data && pendingRes.data.fields) {
        const fields = pendingRes.data.fields;
        if (!targetUserId) targetUserId = fields.userId?.stringValue || "";
        if (!targetEmail) targetEmail = fields.userEmail?.stringValue || "";
        if (!amountToCredit) amountToCredit = fields.amount?.doubleValue || fields.amount?.integerValue || 0;
      }
    } catch (e) {}

    // 2. If targetUserId still unknown, try looking up user by email
    if (!targetUserId && targetEmail) {
      try {
        const usersRes = await axios.get(`${firestoreBase}/users?pageSize=100&key=${FIREBASE_API_KEY}`, { timeout: 5000 });
        const docs = usersRes.data.documents || [];
        const match = docs.find((d: any) => d.fields?.email?.stringValue?.toLowerCase() === targetEmail.toLowerCase());
        if (match) {
          targetUserId = match.name.split("/").pop();
        }
      } catch (e) {}
    }

    if (!targetUserId) {
      return res.status(400).json({
        error: `Could not identify user for UTR ${cleanUtr}. Please specify user email or user ID to credit.`
      });
    }

    if (amountToCredit <= 0) {
      return res.status(400).json({
        error: `Please specify a valid amount greater than ₹0 to credit.`
      });
    }

    // 3. Update user balance
    const userDocRes = await axios.get(`${firestoreBase}/users/${targetUserId}?key=${FIREBASE_API_KEY}`, { timeout: 4000 });
    const currentBal = userDocRes.data.fields?.balance?.doubleValue || userDocRes.data.fields?.balance?.integerValue || 0;
    const newBal = currentBal + amountToCredit;

    await axios.patch(`${firestoreBase}/users/${targetUserId}?updateMask.fieldPaths=balance&key=${FIREBASE_API_KEY}`, {
      fields: {
        balance: { doubleValue: newBal }
      }
    }, { timeout: 4000 });

    // 4. Create approved deposit doc
    const depositId = `dep_man_${cleanUtr}`;
    await axios.patch(`${firestoreBase}/deposits/${depositId}?key=${FIREBASE_API_KEY}`, {
      fields: {
        userId: { stringValue: targetUserId },
        userEmail: { stringValue: targetEmail || "" },
        amount: { doubleValue: amountToCredit },
        utr: { stringValue: cleanUtr },
        status: { stringValue: "approved" },
        paymentMethod: { stringValue: "admin_manual_utr" },
        processedBy: { stringValue: adminEmail || "admin" },
        createdAt: { stringValue: nowIso },
        verifiedAt: { stringValue: nowIso }
      }
    }, { timeout: 4000 });

    // 5. Update pool and pending
    try {
      await axios.patch(`${firestoreBase}/sms_forwarder_pool/${cleanUtr}?key=${FIREBASE_API_KEY}`, {
        fields: {
          utr: { stringValue: cleanUtr },
          amount: { doubleValue: amountToCredit },
          status: { stringValue: "claimed" },
          claimedBy: { stringValue: targetUserId },
          claimedEmail: { stringValue: targetEmail || "" },
          timestamp: { stringValue: nowIso },
          sender: { stringValue: "ADMIN_RESOLVED" }
        }
      }, { timeout: 4000 });
      await axios.delete(`${firestoreBase}/pending_user_utrs/${cleanUtr}?key=${FIREBASE_API_KEY}`, { timeout: 4000 });
    } catch (e) {}

    return res.status(200).json({
      success: true,
      message: `Successfully credited ₹${amountToCredit} to user (${targetEmail || targetUserId}) for UTR ${cleanUtr}!`,
      newBalance: newBal,
      amount: amountToCredit,
      utr: cleanUtr
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
