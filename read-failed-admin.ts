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

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;

    const query = {
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "isSyslog" },
            op: "NOT_EQUAL",
            value: { booleanValue: true }
          }
        },
        orderBy: [{
          field: { fieldPath: "createdAt" },
          direction: "DESCENDING"
        }],
        limit: 15
      }
    };

    console.log(`Querying last 15 orders from DB: ${dbId} via REST...`);
    const res = await axios.post(url, query, { timeout: 10000 });
    
    const results = res.data;
    if (!results || !Array.isArray(results) || results.length === 0 || !results[0].document) {
      console.log("No orders found.");
      return;
    }

    console.log(`Found ${results.length} order items:`);
    for (const item of results) {
      if (item.document) {
        const docName = item.document.name;
        const oId = docName.split("/").pop();
        const fields = unwrapRestFields(item.document.fields || {});
        
        console.log(`\nOrder ID: ${oId}`);
        console.log(`- Course/Service: ${fields.courseTitle}`);
        console.log(`- Status: ${fields.status}`);
        console.log(`- Provider Transmission Status: ${fields.providerTransmissionStatus}`);
        console.log(`- Provider Order ID: ${fields.providerOrderId || "N/A"}`);
        console.log(`- Error: ${fields.error || "None"}`);
        console.log(`- Total Price: ₹${fields.totalPrice}`);
        console.log(`- Target Link: ${fields.targetLink}`);
        console.log(`- Created At: ${fields.createdAt}`);
      }
    }
  } catch (err: any) {
    console.error("ADMIN FETCH FAILED:", err.response?.data || err.message);
  }
}

run();
