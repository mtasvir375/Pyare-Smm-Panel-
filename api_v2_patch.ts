  // Public SMM Panel Standard API Endpoint
  app.all("/api/v2", async (req, res) => {
    const apiKeyParam = req.body.key || req.query.key;
    const action = req.body.action || req.query.action;
    
    if (!apiKeyParam) return res.status(400).json({ error: "API key is required" });
    if (!action) return res.status(400).json({ error: "Action is required" });
    
    try {
      // Find user via API key
      const apiKeyDoc = await getDocSafe("api_keys", String(apiKeyParam));
      if (!apiKeyDoc.exists) return res.status(400).json({ error: "Invalid API key" });
      const userId = apiKeyDoc.data().userId;
      
      const userDoc = await getDocSafe("users", userId);
      if (!userDoc.exists) return res.status(400).json({ error: "User not found" });
      const user = userDoc.data();
      
      if (action === "balance") {
        return res.json({ balance: Number(user.balance || 0).toFixed(4), currency: "INR" });
      }
      
      if (action === "services") {
        const results: any[] = [];
        try {
          // If we have Admin SDK, use it for direct query
          if (adminSdkSucceeded) {
            const snap = await fdb.collection("courses").limit(500).get();
            snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
          } else {
            // Wait, we can't reliably query REST without token if it's not cached. But courses are publicly readable.
            const targetProject = getTargetProject();
            const url = `https://firestore.googleapis.com/v1/projects/${targetProject}/databases/${dbId}/documents/courses?key=${apiKey}&pageSize=500`;
            const resRest = await axios.get(url, { timeout: 10000 });
            if (resRest.data && resRest.data.documents) {
              resRest.data.documents.forEach((doc: any) => {
                results.push({ id: doc.name.split("/").pop(), ...unwrapRestFields(doc.fields || {}) });
              });
            }
          }
        } catch (e) {
          console.warn("[API-V2] Failed to fetch services", e);
        }
        
        const mapped = results.map(c => ({
          service: c.id,
          name: c.title,
          type: c.serviceType || "Default",
          category: c.category || "Default",
          rate: c.pricePerThousand || 0,
          min: c.minLimit || c.packageQuantity || 1,
          max: c.maxLimit || 100000
        }));
        return res.json(mapped);
      }
      
      if (action === "status") {
        const orderId = req.body.order || req.query.order;
        if (!orderId) return res.status(400).json({ error: "Order ID required" });
        const snap = await getDocSafe("orders", String(orderId));
        if (!snap.exists || snap.data().userId !== userId) {
          return res.status(400).json({ error: "Order not found" });
        }
        const data = snap.data();
        let status = data.status || "Pending";
        if (status === "Completed") status = "Completed";
        if (status === "Failed") status = "Canceled"; // Standard SMM status
        
        return res.json({
          status: status,
          charge: data.totalPrice,
          start_count: 0,
          remains: data.quantity,
          currency: "INR"
        });
      }
      
      if (action === "add") {
        const serviceId = req.body.service || req.query.service;
        const link = req.body.link || req.query.link;
        const quantity = Number(req.body.quantity || req.query.quantity);
        
        if (!serviceId || !link || !quantity) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        
        const courseSnap = await getDocSafe("courses", String(serviceId));
        if (!courseSnap.exists) return res.status(400).json({ error: "Invalid service ID" });
        const course = courseSnap.data();
        
        const pricePerItem = Number(course.pricePerThousand || 0) / 1000;
        const totalPrice = Number((pricePerItem * quantity).toFixed(4));
        
        if (Number(user.balance || 0) < totalPrice) {
          return res.status(400).json({ error: "Insufficient balance" });
        }
        
        // Deduct balance manually if on Vercel without token
        if (!adminSdkSucceeded) {
          // If we don't have Admin SDK, we must use REST API.
          // But REST API requires Auth Token to pass security rules for user balance update!
          // Since it's a public API, we don't have the user Auth Token!
          return res.status(500).json({ error: "Server misconfiguration. Cannot process orders without Admin SDK." });
        }
        
        const deductionSuccess = await adjustUserBalanceSafe(userId, -totalPrice);
        if (!deductionSuccess) {
          return res.status(400).json({ error: "Failed to deduct balance" });
        }
        
        const orderId = "ord_v2_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
        const orderData = {
          userId,
          userEmail: user.email || "",
          serviceId: String(serviceId),
          title: course.title,
          category: course.category || "Other",
          quantity,
          targetLink: String(link).trim(),
          totalPrice,
          isCombo: !!course.isCombo,
          comboItems: course.comboItems || [],
          status: "Pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        const createSuccess = await setDocSafe("orders", orderId, orderData);
        if (!createSuccess) {
          return res.status(500).json({ error: "Failed to create order" });
        }
        
        // Transmit directly
        transmitOrderToProviderDirect(orderId, { ...orderData, balanceAlreadyDeducted: true }, false).catch(e => {
          console.error(`[API-V2] Background transmission failed for ${orderId}:`, e.message);
        });
        
        return res.json({ order: orderId });
      }
      
      return res.status(400).json({ error: "Invalid action" });
    } catch (e: any) {
      console.error("[API-V2] Error:", e.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

