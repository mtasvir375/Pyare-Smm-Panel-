import axios from "axios";

async function run() {
  const localUrl = "http://localhost:3000/api/health";
  console.log(`Pinging local dev server at ${localUrl}...`);
  try {
    const res = await axios.get(localUrl, { timeout: 3000 });
    console.log("Success! Local server response:", res.data);
  } catch (err: any) {
    console.error("Local server health check failed:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

run();
