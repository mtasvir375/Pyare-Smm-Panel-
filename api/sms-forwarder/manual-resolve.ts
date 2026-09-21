import { getRestDoc, setRestDoc, deleteRestDoc, listRestDocs } from "../_firestoreRest";

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

    const nowIso = new Date().toISOString();

    // 1. Check if there's a pending user waiting for this UTR
    let targetUserId = reqUserId || "";
    let targetEmail = userEmail || "";
    let amountToCredit = Number(reqAmount || 0);

    try {
      const pendingData = await getRestDoc("pending_user_utrs", cleanUtr);
      if (pendingData) {
        if (!targetUserId) targetUserId = pendingData?.userId || "";
        if (!targetEmail) targetEmail = pendingData?.userEmail || "";
        if (!amountToCredit) amountToCredit = Number(pendingData?.amount || 0);
      }
    } catch (e) {}

    // 2. If targetUserId still unknown, try looking up user by email
    if (!targetUserId && targetEmail) {
      try {
        const users = await listRestDocs("users", 100);
        const matched = users.find((u: any) => u.email?.toLowerCase() === targetEmail.toLowerCase());
        if (matched) {
          targetUserId = matched.id;
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
    const userDoc = await getRestDoc("users", targetUserId);
    const currentBal = userDoc?.balance || 0;
    const newBal = Number(currentBal) + amountToCredit;

    await setRestDoc("users", targetUserId, { balance: newBal });

    // 4. Create approved deposit doc
    const depositId = `dep_man_${cleanUtr}`;
    await setRestDoc("deposits", depositId, {
      userId: targetUserId,
      userEmail: targetEmail || "",
      amount: amountToCredit,
      utr: cleanUtr,
      status: "approved",
      paymentMethod: "admin_manual_utr",
      processedBy: adminEmail || "admin",
      createdAt: nowIso,
      verifiedAt: nowIso
    });

    // 5. Update pool and pending
    try {
      await setRestDoc("sms_forwarder_pool", cleanUtr, {
        utr: cleanUtr,
        amount: amountToCredit,
        status: "claimed",
        claimedBy: targetUserId,
        claimedEmail: targetEmail || "",
        timestamp: nowIso,
        sender: "ADMIN_RESOLVED"
      });

      await deleteRestDoc("pending_user_utrs", cleanUtr);
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
