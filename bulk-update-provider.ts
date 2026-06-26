import axios from "axios";
import fs from "fs";
import path from "path";

// SET THE TARGET PROVIDER ID HERE
const TARGET_PROVIDER_ID = "vHarvsj7cHHNdnkm05bQ"; // The Main Provider (themainsmmprovider.com)
// OR USE: "Oa5YE1tvZbYRvKzXKh8u" // Grate Smm Panel (greatsmm.in)

async function run() {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const { projectId, apiKey } = config;
    const dbId = config.firestoreDatabaseId;

    // 1. Fetch all courses
    console.log("Fetching courses...");
    const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runQuery?key=${apiKey}`;
    const listRes = await axios.post(listUrl, {
      structuredQuery: { from: [{ collectionId: "courses" }] }
    });
    
    const courses = (listRes.data || [])
      .filter((i: any) => i.document)
      .map((i: any) => ({
        id: i.document.name.split("/").pop(),
        title: i.document.fields?.title?.stringValue
      }));

    console.log(`Updating ${courses.length} courses to use Provider ID: ${TARGET_PROVIDER_ID}...`);

    for (const c of courses) {
      const updateUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/courses/${c.id}?key=${apiKey}&updateMask.fieldPaths=providerId`;
      await axios.patch(updateUrl, {
        fields: {
          providerId: { stringValue: TARGET_PROVIDER_ID }
        }
      });
      console.log(`✅ Updated: ${c.title}`);
    }

    console.log("\nALL COURSES UPDATED SUCCESSFULLY!");
  } catch (err: any) {
    console.error("Error:", err.response?.data || err.message);
  }
}

run();
