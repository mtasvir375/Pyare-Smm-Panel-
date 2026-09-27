import { getRestDoc } from "../_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const intentId = req.query?.intentId || req.query?.id;
    if (!intentId) {
      return res.status(400).json({ success: false, error: "Missing intentId" });
    }

    const intent = await getRestDoc("payment_intents", String(intentId));
    if (!intent) {
      return res.status(404).json({ success: false, error: "Payment intent not found or expired." });
    }

    let userBalance: number | undefined;
    if (intent.status === "completed" && intent.userId) {
      try {
        const uDoc = await getRestDoc("users", intent.userId);
        userBalance = uDoc?.balance;
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      status: intent.status,
      intentId: intent.intentId,
      orderRef: intent.orderRef,
      amount: intent.amount,
      baseAmount: intent.baseAmount,
      creditedAmount: intent.amount,
      utr: intent.utr,
      expiresAt: intent.expiresAt,
      completedAt: intent.completedAt,
      newBalance: userBalance
    });
  } catch (err: any) {
    console.error("[VERCEL-CHECK-INTENT-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
