import { listRestDocs } from "../_firestoreRest";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const [allLogs, allPool, allPending] = await Promise.all([
      listRestDocs("sms_forwarder_logs", 100),
      listRestDocs("sms_forwarder_pool", 100),
      listRestDocs("pending_user_utrs", 100)
    ]);

    const logs = allLogs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    const available = allPool.filter((item: any) => item.status === "available");
    const pendingUsers = allPending;

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.status(200).json({
      success: true,
      logs: logs.slice(0, 100),
      available,
      pendingUsers
    });
  } catch (err: any) {
    console.error("[LOGS-API-ERR]", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
