import { getRestDoc, setRestDoc } from "./_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { userId, utr, amount: reqAmount, userEmail } = req.body || {};

    if (!userId) {
      return res.status(400).json({ success: false, error: "User authentication required." });
    }

    const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
    if (cleanUtr.length !== 12) {
      return res.status(400).json({
        success: false,
        error: "Please enter a valid 12-digit UPI / UTR Reference Number."
      });
    }

    const nowIso = new Date().toISOString();

    let alertDoc = await getRestDoc("bank_alerts", cleanUtr);
    if (!alertDoc) {
      alertDoc = await getRestDoc("sms_forwarder_pool", cleanUtr);
    }

    if (!alertDoc) {
      try {
        await setRestDoc("pending_user_utrs", cleanUtr, {
          utr: cleanUtr,
          userId,
          userEmail: userEmail || "",
          amount: Number(reqAmount || 0),
          timestamp: nowIso
        });
      } catch (e) {}

      return res.status(404).json({
        success: false,
        error: `Payment verification pending: No bank alert received for UTR ${cleanUtr} yet. If you just sent payment, please wait 15–30 seconds for the bank confirmation SMS to process, then click Verify again.`
      });
    }

    const isClaimed = alertDoc.isUsed === true || alertDoc.status === "claimed";
    if (isClaimed) {
      const claimedBy = alertDoc.usedBy || alertDoc.claimedBy;
      if (claimedBy === userId) {
        return res.status(200).json({
          success: true,
          amount: Number(alertDoc.amount || reqAmount || 0),
          message: "You have already verified and claimed this UTR."
        });
      }
      return res.status(400).json({
        success: false,
        error: `This UTR (${cleanUtr}) has already been claimed and credited to an account. Duplicate submissions are not permitted.`
      });
    }

    const creditAmount = Number(alertDoc.amount || reqAmount || 0);
    if (creditAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid credited amount found for this transaction."
      });
    }

    let newBalance = creditAmount;
    try {
      const userDoc = await getRestDoc("users", userId);
      const currentBal = Number(userDoc?.balance || 0);
      newBalance = currentBal + creditAmount;
      await setRestDoc("users", userId, { balance: newBalance });
    } catch (uErr: any) {
      console.error("[WALLET-UPDATE-ERR]", uErr.message);
    }

    const depositId = `dep_tg_${Date.now()}_${cleanUtr.slice(-4)}`;
    try {
      await setRestDoc("deposits", depositId, {
        userId,
        userEmail: userEmail || "",
        amount: creditAmount,
        utr: cleanUtr,
        status: "approved",
        paymentMethod: alertDoc.senderBank || "Telegram UPI Bot",
        createdAt: nowIso,
        verifiedAt: nowIso
      });
    } catch (dErr: any) {
      console.error("[DEPOSIT-RECORD-ERR]", dErr.message);
    }

    const updatedAlert = {
      ...alertDoc,
      isUsed: true,
      status: "claimed",
      usedBy: userId,
      usedByEmail: userEmail || "",
      claimedBy: userId,
      claimedEmail: userEmail || "",
      usedAt: nowIso,
      claimedAt: nowIso
    };

    await Promise.all([
      setRestDoc("bank_alerts", cleanUtr, updatedAlert),
      setRestDoc("sms_forwarder_pool", cleanUtr, updatedAlert)
    ]);

    return res.status(200).json({
      success: true,
      amount: creditAmount,
      newBalance,
      message: `🎉 Payment verified! ₹${creditAmount} has been credited to your wallet.`
    });
  } catch (err: any) {
    console.error("[VERIFY-UTR-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
