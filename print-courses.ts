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
    console.log("Fetching courses via runQuery REST API...");
    
    const payload = {
      structuredQuery: {
        from: [{ collectionId: "courses" }]
      }
    };

    const res = await axios.post(url, payload);
    const results = res.data || [];
    console.log(`Found ${results.length} raw results.`);

    const courses = results
      .filter((item: any) => item.document)
      .map((item: any) => {
        const doc = item.document;
        return {
          id: doc.name.split("/").pop(),
          ...unwrapRestFields(doc.fields || {})
        };
      });

    console.log(`Parsed ${courses.length} courses:`);
    for (const c of courses) {
      console.log(`\nID: ${c.id}`);
      console.log(`- Title: ${c.title}`);
      console.log(`- Category: ${c.category}`);
      console.log(`- Provider ID: ${c.providerId}`);
      console.log(`- Provider Service ID: ${c.providerServiceId || c.provider_service_id}`);
      console.log(`- Price Per Thousand: ₹${c.pricePerThousand || c.price_per_thousand}`);
    }

    // Fetch payment settings too
    console.log("\nFetching payment settings...");
    const setUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/settings/payment?key=${apiKey}`;
    const sRes = await axios.get(setUrl);
    const settings = unwrapRestFields(sRes.data.fields || {});
    console.log("Global Payment Settings:", JSON.stringify(settings, null, 2));

  } catch (err: any) {
    console.error("FAILED to fetch data:", err.response?.data || err.message);
  }
}

run();
