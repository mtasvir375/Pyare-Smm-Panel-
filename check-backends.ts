import axios from "axios";

async function check() {
  const devUrl = "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app/api/health";
  const preUrl = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app/api/health";

  console.log("Checking Dev Backend health...");
  try {
    const res = await axios.get(devUrl, { timeout: 8000 });
    console.log("DEV HEALTH OK:", res.data);
  } catch (err: any) {
    console.error("DEV HEALTH FAIL:", err.message);
  }

  console.log("\nChecking Pre Backend health...");
  try {
    const res = await axios.get(preUrl, { timeout: 8000 });
    console.log("PRE HEALTH OK:", res.data);
  } catch (err: any) {
    console.error("PRE HEALTH FAIL:", err.message);
  }
}

check();
