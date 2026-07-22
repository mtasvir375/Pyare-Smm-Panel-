import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as fs from "fs";

const serviceAccount = JSON.parse(fs.readFileSync("./firebase-blueprint.json", "utf8"));
// Use the project ID from metadata if present, or configure manually
const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

async function checkCourses() {
  console.log("Fetching courses from Firestore...");
  const snap = await db.collection("courses").get();
  console.log(`Found ${snap.size} courses total.`);
  
  snap.docs.forEach(doc => {
    const data = doc.data();
    if (data.title?.includes("Reels Views") || data.providerId === "global" || !data.providerId) {
      console.log(`Course ID: ${doc.id}`);
      console.log(`  Title: ${data.title}`);
      console.log(`  Category: ${data.category}`);
      console.log(`  ProviderId: "${data.providerId}"`);
      console.log(`  ProviderServiceId: "${data.providerServiceId}"`);
      console.log("-----------------------------------------");
    }
  });
}

checkCourses().catch(console.error);
