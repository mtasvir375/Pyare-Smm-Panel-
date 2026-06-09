import axios from "axios";
import fs from "fs";
import path from "path";

function unwrapRestFields(fields: any) {
  const result: any = {};
  for (const key in fields) {
    const val = fields[key];
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
    const dbId = config.firestoreDatabaseId || "(default)";

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/settings/payment?key=${apiKey}`;
    console.log("Fetching payment settings raw...");
    const res = await axios.get(url);
    console.log("Payment settings fields:", JSON.stringify(unwrapRestFields(res.data.fields || {}), null, 2));
  } catch (err: any) {
    console.error("FAILED to fetch:", err.response?.data || err.message);
  }
}

run();
