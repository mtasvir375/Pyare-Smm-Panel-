import axios from "axios";

async function check() {
  const url = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app/api/test-provider";

  console.log("Checking PRE backend POST headers...");
  try {
    const res = await axios({
      method: "post",
      url: url,
      headers: {
        "Origin": "https://pyaresmmpanel.live",
        "Content-Type": "application/json"
      },
      data: {
        providerId: ""
      },
      timeout: 8000
    });
    console.log("POST status:", res.status);
    console.log("POST headers:", JSON.stringify(res.headers, null, 2));
    console.log("POST data:", res.data);
  } catch (err: any) {
    console.error("POST failed:", err.message);
    if (err.response) {
      console.error("Response headers:", err.response.headers);
      console.error("Response body:", err.response.data);
    }
  }
}

check();


