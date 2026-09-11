import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function wrapFirestoreFields(data: any): any {
  const fields: any = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string") fields[key] = { stringValue: val };
    else if (typeof val === "number") {
      if (Number.isInteger(val)) fields[key] = { integerValue: val.toString() };
      else fields[key] = { doubleValue: val };
    } else if (typeof val === "boolean") fields[key] = { booleanValue: val };
    else if (Array.isArray(val)) {
      fields[key] = {
        arrayValue: {
          values: val.map((item) => {
            if (typeof item === "string") return { stringValue: item };
            if (typeof item === "number") return Number.isInteger(item) ? { integerValue: item.toString() } : { doubleValue: item };
            if (typeof item === "boolean") return { booleanValue: item };
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof val === "object") {
      fields[key] = { mapValue: { fields: wrapFirestoreFields(val) } };
    }
  }
  return fields;
}

function unwrapDoc(doc: any): any {
  if (!doc) return null;
  const id = doc.name ? doc.name.split("/").pop() : "";
  const fields = doc.fields || {};
  const res: any = { id };
  for (const k of Object.keys(fields)) {
    const f = fields[k];
    if (f.stringValue !== undefined) res[k] = f.stringValue;
    else if (f.integerValue !== undefined) res[k] = Number(f.integerValue);
    else if (f.doubleValue !== undefined) res[k] = Number(f.doubleValue);
    else if (f.booleanValue !== undefined) res[k] = f.booleanValue;
    else if (f.timestampValue !== undefined) res[k] = f.timestampValue;
  }
  return res;
}

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { depositId, action, adminEmail, deposit: clientDeposit } = req.body || {};
    if (!depositId || !action) {
      return res.status(400).json({ error: "Missing depositId or action" });
    }

    let depData = clientDeposit;

    // If client didn't supply full deposit details, fetch the deposit doc from Firestore
    if (!depData || !depData.userId || !depData.amount) {
      const depUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/deposits/${depositId}?key=${FIREBASE_API_KEY}`;
      try {
        const dRes = await axios.get(depUrl, { timeout: 5000 });
        if (dRes.data && dRes.data.fields) {
          depData = unwrapDoc(dRes.data);
        }
      } catch (e: any) {
        return res.status(404).json({ error: "Deposit document not found" });
      }
    }

    const currentStatus = (depData?.status || "").toLowerCase();
    if (currentStatus === "approved" && action === "approved") {
      return res.json({ success: true, message: "Deposit is already approved", deposit: depData });
    }
    if (currentStatus === "cancelled" && action === "cancelled") {
      return res.json({ success: true, message: "Deposit is already cancelled", deposit: depData });
    }

    const userId = depData?.userId || depData?.user_id;
    const amount = Number(depData?.amount || 0);

    if (action === "approved") {
      if (!userId) {
        return res.status(400).json({ error: "Deposit is missing userId" });
      }
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: "Invalid deposit amount" });
      }

      // Fetch user to adjust balance
      const userUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/users/${userId}?key=${FIREBASE_API_KEY}`;
      const uRes = await axios.get(userUrl, { timeout: 5000 });
      let currentBal = 0;
      if (uRes.data && uRes.data.fields) {
        currentBal = Number(uRes.data.fields.balance?.integerValue || uRes.data.fields.balance?.doubleValue || 0);
      }

      const newBal = Number((currentBal + amount).toFixed(2));

      // Update user wallet balance
      await axios.patch(
        `${userUrl}&updateMask.fieldPaths=balance`,
        { fields: { balance: { doubleValue: newBal } } },
        { timeout: 5000 }
      );

      // Update deposit status to approved
      const depUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/deposits/${depositId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=status&updateMask.fieldPaths=verifiedAt&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=processedBy`;
      await axios.patch(
        depUrl,
        {
          fields: {
            status: { stringValue: "approved" },
            verifiedAt: { stringValue: new Date().toISOString() },
            updatedAt: { stringValue: new Date().toISOString() },
            processedBy: { stringValue: adminEmail || "admin" }
          }
        },
        { timeout: 5000 }
      );

      return res.json({
        success: true,
        status: "approved",
        depositId,
        amount,
        userId,
        newBalance: newBal,
        message: `Deposit ₹${amount} approved successfully!`
      });
    } else {
      // Action is cancelled
      const depUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/deposits/${depositId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=processedBy`;
      await axios.patch(
        depUrl,
        {
          fields: {
            status: { stringValue: "cancelled" },
            updatedAt: { stringValue: new Date().toISOString() },
            processedBy: { stringValue: adminEmail || "admin" }
          }
        },
        { timeout: 5000 }
      );

      return res.json({
        success: true,
        status: "cancelled",
        depositId,
        message: "Deposit marked as cancelled."
      });
    }
  } catch (err: any) {
    console.error("[VERCEL-PROCESS-DEPOSIT-ERROR]", err.message);
    return res.status(500).json({ error: "Failed to process deposit: " + err.message });
  }
}
