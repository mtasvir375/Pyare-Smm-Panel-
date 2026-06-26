import axios from "axios";
import fs from "fs";
import path from "path";

function unwrapRestFields(fields: any) {
  const result: any = {};
  for (const key in fields) {
    const val = fields[key];
    if (!val) continue;
    if (val.stringValue !== undefined) result[key] = val.stringValue;
    else if (val.integerValue !== undefined) result[key] = parseInt(val.integerValue);
    else if (val.doubleValue !== undefined) result[key] = parseFloat(val.doubleValue);
    else if (val.booleanValue !== undefined) result[key] = val.booleanValue;
    else if (val.timestampValue !== undefined) result[key] = val.timestampValue;
    else if (val.mapValue !== undefined) result[key] = unwrapRestFields(val.mapValue.fields || {});
  }
  return result;
}

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c";

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/backend_logs?key=${apiKey}&pageSize=50`;
    console.log("Fetching logs...");
    const res = await axios.get(url, {
      headers: {
        "Referer": "https://gen-lang-client-0629912823.firebaseapp.com/"
      }
    });
    const documents = res.data.documents || [];
    console.log(`Found ${documents.length} log documents.`);
    
    const sortedDocs = documents.map((doc: any) => ({
      id: doc.name.split("/").pop(),
      fields: unwrapRestFields(doc.fields || {}),
      createTime: doc.createTime
    })).sort((a: any, b: any) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());

    for (const doc of sortedDocs.slice(0, 15)) {
      console.log(`\nLog ID: ${doc.id}`);
      console.log(`- Data:`, JSON.stringify(doc.fields, null, 2));
    }
  } catch (err: any) {
    console.error("FAILED to fetch logs:", err.response?.data || err.message);
  }
}

run();
