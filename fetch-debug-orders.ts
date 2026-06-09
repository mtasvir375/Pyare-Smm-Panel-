import axios from "axios";

async function run() {
  try {
    const localUrl = "http://localhost:3000/api/debug-orders";
    console.log(`Fetching local /api/debug-orders from: ${localUrl}...`);
    const res = await axios.get(localUrl);
    console.log("Success! Count:", res.data.count);
    const orders = res.data.orders || [];
    for (const order of orders) {
      console.log(`\nOrder ID: ${order.id}`);
      console.log(`- Course/Service: ${order.courseTitle}`);
      console.log(`- Status: ${order.status}`);
      console.log(`- Price: ₹${order.totalPrice}`);
      console.log(`- Link: ${order.targetLink}`);
      console.log(`- Needs Transmission: ${order.needsProviderTransmission}`);
      console.log(`- Transmission Status: ${order.providerTransmissionStatus}`);
      console.log(`- Error: ${order.error || "None"}`);
      console.log(`- Raw Provider Resp: ${order.providerRawResponse || "None"}`);
    }
  } catch (err: any) {
    console.error("Local fetch failed:", err.response?.data || err.message);
  }
}

run();
