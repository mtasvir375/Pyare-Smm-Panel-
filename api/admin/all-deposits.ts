import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const limitCount = Math.min(Number(req.query?.limit) || 100, 100);
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents:runQuery?key=${FIREBASE_API_KEY}`;
    
    const depositMap = new Map<string, any>();

    // 1. Query pending deposits first
    try {
      const pendingRes = await axios.post(queryUrl, {
        structuredQuery: {
          from: [{ collectionId: "deposits" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "status" },
              op: "EQUAL",
              value: { stringValue: "pending" }
            }
          },
          limit: 50
        }
      }, { timeout: 10000 });

      if (pendingRes.data && Array.isArray(pendingRes.data)) {
        pendingRes.data.forEach((item: any) => {
          if (item.document) {
            const docData = unwrapDoc(item.document);
            if (docData && docData.id) {
              depositMap.set(docData.id, docData);
            }
          }
        });
      }
    } catch (pErr: any) {
      console.warn("[VERCEL-ALL-DEPOSITS] Pending query warning:", pErr.message);
    }

    // 2. Query general recent deposits
    try {
      const allRes = await axios.post(queryUrl, {
        structuredQuery: {
          from: [{ collectionId: "deposits" }],
          limit: limitCount
        }
      }, { timeout: 10000 });

      if (allRes.data && Array.isArray(allRes.data)) {
        allRes.data.forEach((item: any) => {
          if (item.document) {
            const docData = unwrapDoc(item.document);
            if (docData && docData.id) {
              depositMap.set(docData.id, docData);
            }
          }
        });
      }
    } catch (aErr: any) {
      console.warn("[VERCEL-ALL-DEPOSITS] All query warning:", aErr.message);
    }

    const allList = Array.from(depositMap.values());

    // Sort: Pending deposits first, then newest first
    allList.sort((a: any, b: any) => {
      const aPending = (a.status || "").toLowerCase() === "pending" ? 1 : 0;
      const bPending = (b.status || "").toLowerCase() === "pending" ? 1 : 0;
      if (aPending !== bPending) return bPending - aPending;

      const aTime = new Date(a.createdAt || a.timestamp || 0).getTime();
      const bTime = new Date(b.createdAt || b.timestamp || 0).getTime();
      return bTime - aTime;
    });

    return res.status(200).json(allList.slice(0, limitCount));
  } catch (err: any) {
    console.error("[VERCEL-ALL-DEPOSITS-ERROR]", err.message);
    return res.status(500).json({ error: "Failed to fetch deposits: " + err.message });
  }
}
