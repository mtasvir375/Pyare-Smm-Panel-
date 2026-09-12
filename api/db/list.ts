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
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { collection, limit: pageSize = 25 } = req.body || {};
  if (!collection) {
    return res.status(400).json({ error: "Missing collection" });
  }

  try {
    const effectiveLimit = Math.min(Number(pageSize) || 25, 50);
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/${collection}?key=${FIREBASE_API_KEY}&pageSize=${effectiveLimit}`;
    const response = await axios.get(url, { timeout: 8000 });
    
    const results: any[] = [];
    if (response.data && response.data.documents) {
      response.data.documents.forEach((doc: any) => {
        const unwrapped = unwrapDoc(doc);
        if (unwrapped) results.push(unwrapped);
      });
    }
    return res.status(200).json({ success: true, data: results });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "Failed to list documents" });
  }
}
