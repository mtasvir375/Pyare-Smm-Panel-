import { setRestDoc } from "./_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { amount = 100, bank = "PhonePe UPI", customText } = req.body || {};
    const parsedAmount = Math.max(1, Number(amount) || 100);

    const random12 = `9${Math.floor(10000000000 + Math.random() * 90000000000).toString().slice(0, 11)}`;
    const nowIso = new Date().toISOString();

    const sampleText = customText ||
      `Dear SBI UPI User, A/C ..4102 credited by Rs.${parsedAmount}.00 on ${new Date().toLocaleDateString("en-IN")} transfer from Payer Ref No ${random12} -SBI`;

    const alertData = {
      id: `alert_${random12}_${Date.now()}`,
      utr: random12,
      amount: parsedAmount,
      senderBank: bank,
      rawText: sampleText,
      timestamp: nowIso,
      status: "available",
      isUsed: false
    };

    await Promise.all([
      setRestDoc("bank_alerts", random12, alertData),
      setRestDoc("sms_forwarder_pool", random12, {
        utr: random12,
        amount: parsedAmount,
        sender: bank,
        rawSms: sampleText,
        timestamp: nowIso,
        status: "available"
      })
    ]);

    return res.status(200).json({
      success: true,
      message: `Simulated bank alert created for ₹${parsedAmount} (UTR: ${random12})`,
      alert: alertData
    });
  } catch (err: any) {
    console.error("[SIMULATE-SMS-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
