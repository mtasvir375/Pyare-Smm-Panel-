import { db } from "../_firebase";
import { collection, getDocs } from "firebase/firestore";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const [logsSnap, poolSnap, pendingSnap] = await Promise.allSettled([
      getDocs(collection(db, "sms_forwarder_logs")),
      getDocs(collection(db, "sms_forwarder_pool")),
      getDocs(collection(db, "pending_user_utrs"))
    ]);

    const logs: any[] = [];
    if (logsSnap.status === "fulfilled") {
      logsSnap.value.forEach((d) => {
        logs.push({ id: d.id, ...d.data() });
      });
      logs.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    }

    const available: any[] = [];
    if (poolSnap.status === "fulfilled") {
      poolSnap.value.forEach((d) => {
        const item: any = d.data();
        if (item.status === "available") {
          available.push(item);
        }
      });
    }

    const pendingUsers: any[] = [];
    if (pendingSnap.status === "fulfilled") {
      pendingSnap.value.forEach((d) => {
        pendingUsers.push(d.data());
      });
    }

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
