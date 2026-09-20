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
    const { utr, amount: reqAmount, userId, userEmail } = req.body || {};
    if (!utr || !userId) {
      return res.status(400).json({ error: "Missing required fields (utr, userId)" });
    }

    const cleanUtr = String(utr).replace(/\D/g, "");
    if (cleanUtr.length !== 12) {
      return res.status(400).json({ error: "Invalid UTR format. Must be 12 digits." });
    }

    const firestoreBase = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents`;

    // 1. Check if UTR exists in sms_forwarder_pool
    let poolDoc: any = null;
    try {
      const poolRes = await axios.get(`${firestoreBase}/sms_forwarder_pool/${cleanUtr}?key=${FIREBASE_API_KEY}`, { timeout: 5000 });
      if (poolRes.data && poolRes.data.fields) {
        poolDoc = poolRes.data.fields;
      }
    } catch (e: any) {
      // Not in pool yet
    }

    const nowIso = new Date().toISOString();

    if (poolDoc) {
      const status = poolDoc.status?.stringValue || "available";
      const poolAmount = poolDoc.amount?.doubleValue || poolDoc.amount?.integerValue || Number(reqAmount || 0);

      if (status === "claimed") {
        const claimedBy = poolDoc.claimedBy?.stringValue || "";
        if (claimedBy === userId) {
          return res.status(200).json({
            success: true,
            status: 200,
            amount: poolAmount,
            message: "You have already verified and claimed this UTR."
          });
        }
        return res.status(400).json({
          success: false,
          error: `UTR ${cleanUtr} has already been claimed by another account.`
        });
      }

      // Claim payment!
      // Update user balance in Firestore
      let newBalance = poolAmount;
      try {
        const userSnap = await axios.get(`${firestoreBase}/users/${userId}?key=${FIREBASE_API_KEY}`, { timeout: 5000 });
        const currentBal = userSnap.data?.fields?.balance?.doubleValue || userSnap.data?.fields?.balance?.integerValue || 0;
        newBalance = currentBal + poolAmount;

        await axios.patch(`${firestoreBase}/users/${userId}?updateMask.fieldPaths=balance&key=${FIREBASE_API_KEY}`, {
          fields: {
            balance: { doubleValue: newBalance }
          }
        }, { timeout: 5000 });
      } catch (userErr: any) {
        console.error("[USER-BAL-UPDATE-FAIL]", userErr.message);
      }

      // Create deposit doc in Firestore
      const depositId = `dep_${Date.now()}_${cleanUtr.slice(-4)}`;
      try {
        await axios.patch(`${firestoreBase}/deposits/${depositId}?key=${FIREBASE_API_KEY}`, {
          fields: {
            userId: { stringValue: userId },
            userEmail: { stringValue: userEmail || "" },
            amount: { doubleValue: poolAmount },
            utr: { stringValue: cleanUtr },
            status: { stringValue: "approved" },
            paymentMethod: { stringValue: "sms_forwarder" },
            createdAt: { stringValue: nowIso },
            verifiedAt: { stringValue: nowIso }
          }
        }, { timeout: 5000 });
      } catch (depErr: any) {
        console.error("[DEPOSIT-DOC-FAIL]", depErr.message);
      }

      // Mark pool as claimed
      await axios.patch(`${firestoreBase}/sms_forwarder_pool/${cleanUtr}?updateMask.fieldPaths=status&updateMask.fieldPaths=claimedBy&updateMask.fieldPaths=claimedEmail&updateMask.fieldPaths=claimedAt&key=${FIREBASE_API_KEY}`, {
        fields: {
          status: { stringValue: "claimed" },
          claimedBy: { stringValue: userId },
          claimedEmail: { stringValue: userEmail || "" },
          claimedAt: { stringValue: nowIso }
        }
      }, { timeout: 5000 });

      return res.status(200).json({
        success: true,
        status: 200,
        amount: poolAmount,
        newBalance,
        message: `Payment verified successfully! ₹${poolAmount} added to your wallet.`
      });
    }

    // 2. Not in pool yet - Save to pending_user_utrs so as soon as SMS lands, it auto-credits!
    try {
      await axios.patch(`${firestoreBase}/pending_user_utrs/${cleanUtr}?key=${FIREBASE_API_KEY}`, {
        fields: {
          utr: { stringValue: cleanUtr },
          userId: { stringValue: userId },
          userEmail: { stringValue: userEmail || "" },
          amount: { doubleValue: Number(reqAmount || 0) },
          timestamp: { stringValue: nowIso }
        }
      }, { timeout: 5000 });
    } catch (pendErr: any) {
      console.warn("[PENDING-USER-SAVE-FAIL]", pendErr.message);
    }

    return res.status(400).json({
      success: false,
      status: 400,
      error: `Payment verification pending: No confirmed transaction received yet for UTR ${cleanUtr}. If you just completed the payment, please wait 15–30 seconds for the Bank/UPI SMS to arrive, then click Confirm again.`
    });
  } catch (err: any) {
    console.error("[VERCEL-VERIFY-QR-AUTO-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
