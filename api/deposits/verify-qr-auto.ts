import { db } from "../_firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

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

    const nowIso = new Date().toISOString();

    // 1. Check if UTR exists in sms_forwarder_pool
    const poolDocRef = doc(db, "sms_forwarder_pool", cleanUtr);
    const poolSnap = await getDoc(poolDocRef);

    if (poolSnap.exists()) {
      const poolData = poolSnap.data();
      const status = poolData?.status || "available";
      const poolAmount = Number(poolData?.amount || reqAmount || 0);

      if (status === "claimed") {
        const claimedBy = poolData?.claimedBy || "";
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
        const userDocRef = doc(db, "users", userId);
        const userSnap = await getDoc(userDocRef);
        const currentBal = userSnap.exists() ? (userSnap.data()?.balance || 0) : 0;
        newBalance = Number(currentBal) + poolAmount;

        await setDoc(userDocRef, { balance: newBalance }, { merge: true });
      } catch (userErr: any) {
        console.error("[USER-BAL-UPDATE-FAIL]", userErr.message);
      }

      // Create deposit doc in Firestore
      const depositId = `dep_${Date.now()}_${cleanUtr.slice(-4)}`;
      try {
        await setDoc(doc(db, "deposits", depositId), {
          userId,
          userEmail: userEmail || "",
          amount: poolAmount,
          utr: cleanUtr,
          status: "approved",
          paymentMethod: "sms_forwarder",
          createdAt: nowIso,
          verifiedAt: nowIso
        });
      } catch (depErr: any) {
        console.error("[DEPOSIT-DOC-FAIL]", depErr.message);
      }

      // Mark pool as claimed
      await setDoc(poolDocRef, {
        status: "claimed",
        claimedBy: userId,
        claimedEmail: userEmail || "",
        claimedAt: nowIso
      }, { merge: true });

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
      await setDoc(doc(db, "pending_user_utrs", cleanUtr), {
        utr: cleanUtr,
        userId,
        userEmail: userEmail || "",
        amount: Number(reqAmount || 0),
        timestamp: nowIso
      });
    } catch (pendErr: any) {
      console.warn("[PENDING-USER-SAVE-FAIL]", pendErr.message);
    }

    return res.status(400).json({
      success: false,
      status: 400,
      error: `Payment verification pending: No confirmed transaction received yet for UTR ${cleanUtr}. If you just completed the payment, please wait 15–30 seconds for the Bank/UPI SMS to arrive, then click Confirm again.`
    });
  } catch (err: any) {
    console.error("[VERIFY-QR-AUTO-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
