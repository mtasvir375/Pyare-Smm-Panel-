import axios from "axios";

async function test() {
  try {
    console.log("Querying /api/test-firebase diagnostic endpoint...");
    const res = await axios.get("http://localhost:3000/api/test-firebase");
    console.log("DIAGNOSTIC RESULTS:");
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("Endpoint query failed:", err.response?.data || err.message);
  }
}

test();
