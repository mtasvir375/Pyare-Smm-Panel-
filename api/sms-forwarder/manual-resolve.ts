import { db } from "../_firebase";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

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
      const pendingSnap = await getDoc(doc(db, "pending_user_utrs", cleanUtr));
      if (pendingSnap.exists()) {
        const fields = pendingSnap.data();
        if (!targetUserId) targetUserId = fields?.userId || "";
        if (!targetEmail) targetEmail = fields?.userEmail || "";
        if (!amountToCredit) amountToCredit = Number(fields?.amount || 0);
      }
    } catch (e) {}

    // 2. If targetUserId still unknown, try looking up user by email
    if (!targetUserId && targetEmail) {
      try {
        const usersSnap = await getDocs(collection(db, "users"));
        usersSnap.forEach((d) => {
          const data = d.data();
          if (data?.email?.toLowerCase() === targetEmail.toLowerCase()) {
            targetUserId = d.id;
          }
        });
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
    const userDocRef = doc(db, "users", targetUserId);
    const userSnap = await getDoc(userDocRef);
    const currentBal = userSnap.exists() ? (userSnap.data()?.balance || 0) : 0;
    const newBal = Number(currentBal) + amountToCredit;

    await setDoc(userDocRef, { balance: newBal }, { merge: true });

    // 4. Create approved deposit doc
    const depositId = `dep_man_${cleanUtr}`;
    await setDoc(doc(db, "deposits", depositId), {
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
      await setDoc(doc(db, "sms_forwarder_pool", cleanUtr), {
        utr: cleanUtr,
        amount: amountToCredit,
        status: "claimed",
        claimedBy: targetUserId,
        claimedEmail: targetEmail || "",
        timestamp: nowIso,
        sender: "ADMIN_RESOLVED"
      }, { merge: true });

      await deleteDoc(doc(db, "pending_user_utrs", cleanUtr));
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
