import { listRestDocs } from "./_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { filter = "all", search = "" } = req.query || {};

    const [poolDocs, alertDocs] = await Promise.all([
      listRestDocs("sms_forwarder_pool", 100),
      listRestDocs("bank_alerts", 100)
    ]);

    const map = new Map<string, any>();

    for (const doc of [...alertDocs, ...poolDocs]) {
      const utr = doc.utr || doc.id;
      if (!utr || map.has(utr)) continue;

      const isUsed = doc.status === "claimed" || doc.isUsed === true;
      map.set(utr, {
        id: doc.id || `alert_${utr}`,
        utr,
        amount: Number(doc.amount || 0),
        senderBank: doc.senderBank || doc.sender || "UPI Payment",
        rawText: doc.rawText || doc.rawSms || "",
        timestamp: doc.timestamp || new Date().toISOString(),
        isUsed,
        usedBy: doc.usedBy || doc.claimedBy || "",
        usedByEmail: doc.usedByEmail || doc.claimedEmail || "",
        usedAt: doc.usedAt || doc.claimedAt || ""
      });
    }

    let allAlerts = Array.from(map.values());
    allAlerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const totalCount = allAlerts.length;
    const unusedCount = allAlerts.filter((a) => !a.isUsed).length;
    const usedCount = allAlerts.filter((a) => a.isUsed).length;

    let filtered = allAlerts;
    if (filter === "unused") {
      filtered = filtered.filter((a) => !a.isUsed);
    } else if (filter === "used") {
      filtered = filtered.filter((a) => a.isUsed);
    }

    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((a) =>
        a.utr.toLowerCase().includes(q) ||
        a.senderBank.toLowerCase().includes(q) ||
        String(a.amount).includes(q) ||
        (a.usedByEmail && a.usedByEmail.toLowerCase().includes(q))
      );
    }

    return res.status(200).json({
      success: true,
      alerts: filtered,
      totalCount,
      unusedCount,
      usedCount
    });
  } catch (err: any) {
    console.error("[BANK-ALERTS-HANDLER-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
