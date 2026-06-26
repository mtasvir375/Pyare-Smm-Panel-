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

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
    console.log("Fetching providers via runQuery REST API...");
    
    const payload = {
      structuredQuery: {
        from: [{ collectionId: "providers" }]
      }
    };

    const res = await axios.post(url, payload);
    const results = res.data || [];
    console.log(`Found ${results.length} raw provider results.`);

    const providers = results
      .filter((item: any) => item.document)
      .map((item: any) => {
        const doc = item.document;
        return {
          id: doc.name.split("/").pop(),
          ...unwrapRestFields(doc.fields || {})
        };
      });

    console.log(`Parsed ${providers.length} providers:`);
    for (const p of providers) {
      console.log(`\nID: ${p.id}`);
      console.log(`- Name: ${p.name}`);
      console.log(`- API URL: ${p.apiUrl || p.api_url}`);
      console.log(`- API Key (first 6 chars): ${(p.apiKey || p.api_key || "").substring(0, 6)}...`);
    }

  } catch (err: any) {
    console.error("FAILED to fetch providers:", err.response?.data || err.message);
  }
}

run();
