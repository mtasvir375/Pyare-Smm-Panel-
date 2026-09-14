import axios from "axios";

const FIREBASE_PROJECT_ID = "gen-lang-client-0629912823";
const FIREBASE_DATABASE_ID = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";
const FIREBASE_API_KEY = process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY";

function unwrapFirestoreFields(fields: any): any {
  if (!fields) return {};
  const res: any = {};
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val.stringValue !== undefined) res[key] = val.stringValue;
    else if (val.integerValue !== undefined) res[key] = parseInt(val.integerValue, 10);
    else if (val.doubleValue !== undefined) res[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) res[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) res[key] = val.timestampValue;
    else if (val.arrayValue && val.arrayValue.values) {
      res[key] = val.arrayValue.values.map((v: any) => {
        if (v.stringValue !== undefined) return v.stringValue;
        if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
        if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
        if (v.booleanValue !== undefined) return v.booleanValue;
        if (v.mapValue) return unwrapFirestoreFields(v.mapValue.fields);
        return v;
      });
    } else if (val.mapValue && val.mapValue.fields) {
      res[key] = unwrapFirestoreFields(val.mapValue.fields);
    } else {
      res[key] = null;
    }
  }
  return res;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIREBASE_DATABASE_ID}/documents/courses?pageSize=300&key=${FIREBASE_API_KEY}`;
    const response = await axios.get(url, { timeout: 6000 });
    const documents = response.data.documents || [];
    const courses = documents.map((doc: any) => {
      const parts = doc.name.split("/");
      const id = parts[parts.length - 1];
      const data = unwrapFirestoreFields(doc.fields);
      return { id, ...data };
    });

    const categoryOrder = ["Instagram", "YouTube", "Facebook", "TikTok", "Telegram", "Twitter", "Other"];
    const getTimestamp = (item: any) => {
      const val = item.updatedAt || item.updated_at || item.createdAt || item.created_at;
      if (!val) return 0;
      if (typeof val.toDate === "function") return val.toDate().getTime();
      if (typeof val.seconds === "number") return val.seconds * 1000;
      if (val._seconds !== undefined) return val._seconds * 1000;
      const t = new Date(val).getTime();
      return isNaN(t) ? 0 : t;
    };

    courses.sort((a: any, b: any) => {
      const catA = a.category || "Other";
      const catB = b.category || "Other";

      if (catA.toLowerCase() === "instagram" && catB.toLowerCase() !== "instagram") return -1;
      if (catB.toLowerCase() === "instagram" && catA.toLowerCase() !== "instagram") return 1;

      const orderA = categoryOrder.findIndex(c => c.toLowerCase() === catA.toLowerCase());
      const orderB = categoryOrder.findIndex(c => c.toLowerCase() === catB.toLowerCase());
      const rankA = orderA === -1 ? 999 : orderA;
      const rankB = orderB === -1 ? 999 : orderB;
      if (rankA !== rankB) return rankA - rankB;

      // Within category: latest updated / added on top
      const timeA = getTimestamp(a);
      const timeB = getTimestamp(b);
      return timeB - timeA;
    });

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(courses);
  } catch (err: any) {
    console.error("[VERCEL-API-COURSES] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
