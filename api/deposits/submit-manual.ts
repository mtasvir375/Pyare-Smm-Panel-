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
            if (typeof item === "object") return { mapValue: { fields: wrapFirestoreFields(item) } };
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
    else if (f.arrayValue !== undefined) {
      res[k] = (f.arrayValue.values || []).map((v: any) => v.stringValue || v.integerValue || v.doubleValue || v.booleanValue || v);
    } else if (f.mapValue !== undefined) {
      res[k] = unwrapDoc(f.mapValue);
    }
  }
  return res;
}

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { amount, utr, screenshotUrl, userId, userEmail } = req.body || {};
    const user_id = userId;
    const user_email = userEmail;
    const depositAmount = Number(amount);

    if (!user_id || !depositAmount || isNaN(depositAmount) || depositAmount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount or user ID." });
    }

    const cleanUtr = String(utr || "").replace(/\D/g, "").trim();
    if (cleanUtr.length < 10 || cleanUtr.length > 18) {
      return res.status(400).json({ error: "Invalid UTR format. Must be a 10-18 digit UPI reference number (normally 12 digits)." });
    }

    const authHeader = req.headers.authorization;
    const headers: any = { "Content-Type": "application/json" };
    if (authHeader) headers["Authorization"] = authHeader;

    // 1. Check if UTR already exists in deposits collection
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    
    try {
      const checkDupRes = await axios.post(queryUrl, {
        structuredQuery: {
          from: [{ collectionId: "deposits" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "utr" },
              op: "EQUAL",
              value: { stringValue: cleanUtr }
            }
          },
          limit: 5
        }
      }, { headers, timeout: 6000 });

      if (Array.isArray(checkDupRes.data)) {
        for (const item of checkDupRes.data) {
          if (item.document) {
            const docData = unwrapDoc(item.document);
            if (docData.status === "approved" || docData.status === "completed") {
              return res.status(400).json({ error: "This UTR number has already been verified and credited. Duplicate submissions are not allowed." });
            }
            if (docData.status === "pending") {
              return res.status(400).json({ error: "A deposit with this UTR is already submitted and pending verification. Please wait a moment." });
            }
          }
        }
      }
    } catch (dupErr: any) {
      console.warn("[VERCEL-DEPOSIT] Duplicate check warning:", dupErr.message);
    }

    // 2. Check Bank SMS logs or global auto-approve
    let isAutoApproved = false;
    let matchedSmsId = "";

    try {
      const smsQueryRes = await axios.post(queryUrl, {
        structuredQuery: {
          from: [{ collectionId: "bank_sms_logs" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "candidateUtrs" },
                    op: "ARRAY_CONTAINS",
                    value: { stringValue: cleanUtr }
                  }
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "isUsed" },
                    op: "EQUAL",
                    value: { booleanValue: false }
                  }
                }
              ]
            }
          },
          limit: 1
        }
      }, { headers, timeout: 6000 });

      if (Array.isArray(smsQueryRes.data)) {
        for (const item of smsQueryRes.data) {
          if (item.document) {
            const smsData = unwrapDoc(item.document);
            const amtMatches = !smsData.parsedAmount || Number(smsData.parsedAmount) >= depositAmount || Math.abs(Number(smsData.parsedAmount) - depositAmount) <= 1;
            if (amtMatches) {
              isAutoApproved = true;
              matchedSmsId = smsData.id;
              break;
            }
          }
        }
      }
    } catch (smsErr: any) {
      console.warn("[VERCEL-DEPOSIT] SMS match warning:", smsErr.message);
    }

    // Check settings/payment for autoApproveDeposits
    if (!isAutoApproved) {
      try {
        const settingsUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/settings/payment?key=${FIREBASE_API_KEY}`;
        const sRes = await axios.get(settingsUrl, { headers, timeout: 4000 });
        if (sRes.data && sRes.data.fields && sRes.data.fields.autoApproveDeposits?.booleanValue === true) {
          isAutoApproved = true;
        }
      } catch (sErr) {}
    }

    // If auto-approved, credit user balance
    if (isAutoApproved) {
      try {
        const userUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/users/${user_id}?key=${FIREBASE_API_KEY}`;
        const uRes = await axios.get(userUrl, { headers, timeout: 5000 });
        if (uRes.data && uRes.data.fields) {
          const currentBalance = Number(uRes.data.fields.balance?.integerValue || uRes.data.fields.balance?.doubleValue || 0);
          const newBal = Number((currentBalance + depositAmount).toFixed(2));
          await axios.patch(userUrl + "&updateMask.fieldPaths=balance", {
            fields: { balance: { doubleValue: newBal } }
          }, { headers, timeout: 5000 });
          console.log(`[VERCEL-DEPOSIT] Auto-credited ₹${depositAmount} to user ${user_id}. New balance: ₹${newBal}`);
        }

        if (matchedSmsId) {
          const smsDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/bank_sms_logs/${matchedSmsId}?key=${FIREBASE_API_KEY}&updateMask.fieldPaths=isUsed&updateMask.fieldPaths=usedByUserId&updateMask.fieldPaths=usedForDepositAmount&updateMask.fieldPaths=usedAt`;
          await axios.patch(smsDocUrl, {
            fields: {
              isUsed: { booleanValue: true },
              usedByUserId: { stringValue: user_id },
              usedForDepositAmount: { doubleValue: depositAmount },
              usedAt: { stringValue: new Date().toISOString() }
            }
          }, { headers, timeout: 5000 }).catch(() => {});
        }
      } catch (credErr: any) {
        console.error("[VERCEL-DEPOSIT] Failed to credit balance:", credErr.message);
        isAutoApproved = false;
      }
    }

    // 3. Create Deposit document in Firestore
    const depositId = `dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newDepositDoc = {
      id: depositId,
      userId: user_id,
      userEmail: user_email || "not-provided",
      amount: depositAmount,
      utr: cleanUtr,
      screenshotUrl: screenshotUrl || "",
      status: isAutoApproved ? "approved" : "pending",
      type: "deposit",
      verifiedAt: isAutoApproved ? new Date().toISOString() : null,
      verifiedMethod: isAutoApproved ? (matchedSmsId ? "bank-sms-instant" : "admin-auto-approve") : null,
      smsLogId: matchedSmsId || null,
      createdAt: new Date().toISOString()
    };

    const depDocUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/deposits/${depositId}?key=${FIREBASE_API_KEY}`;
    await axios.patch(depDocUrl, { fields: wrapFirestoreFields(newDepositDoc) }, { headers, timeout: 8000 });

    return res.status(200).json({
      success: true,
      isAutoApproved,
      id: depositId,
      deposit: newDepositDoc,
      message: isAutoApproved
        ? `Payment verified & ₹${depositAmount} added to your wallet instantly!`
        : "Deposit request submitted successfully. It will be reviewed and approved by admin."
    });
  } catch (err: any) {
    console.error("[VERCEL-DEPOSIT] Submission error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to submit deposit request."
    });
  }
}
