import { getRestDoc, setRestDoc } from "../_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { amount, userId, userEmail } = req.body || {};
    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount < 1) {
      return res.status(400).json({ success: false, error: "Minimum deposit amount is ₹1." });
    }
    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID is required." });
    }

    // 1. Fetch settings from Firestore for active UPI ID & Payee Name
    let settings: any = {};
    try {
      settings = (await getRestDoc("settings", "payment")) || {};
    } catch {}

    const upiId = (settings.upiId || "mdsaudalam621@okicici").trim();
    const payeeName = (settings.merchantName || "Pyare SMM Panel").trim();

    // 2. Generate unique 12-digit numeric Order Ref
    const part1 = Math.floor(100000 + Math.random() * 900000).toString();
    const part2 = Math.floor(100000 + Math.random() * 900000).toString();
    const orderRef = `${part1}${part2}`;

    const now = Date.now();
    const intentId = `pi_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = now + 30 * 60 * 1000;
    const finalAmount = numAmount;

    const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${finalAmount.toFixed(2)}&tr=${orderRef}&tn=${orderRef}&cu=INR`;

    const intentData = {
      intentId,
      orderRef,
      baseAmount: numAmount,
      amount: finalAmount,
      userId: String(userId),
      userEmail: userEmail ? String(userEmail) : "",
      upiId,
      payeeName,
      upiLink,
      status: "pending",
      createdAt: now,
      expiresAt,
      notified: false
    };

    // Save to Firestore
    await setRestDoc("payment_intents", intentId, intentData);

    return res.status(200).json({
      success: true,
      intentId,
      orderRef,
      baseAmount: numAmount,
      amount: finalAmount,
      upiId,
      payeeName,
      upiLink,
      expiresAt
    });
  } catch (err: any) {
    console.error("[VERCEL-CREATE-INTENT-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
