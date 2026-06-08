/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import axios from "axios";
import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./lib/firebase";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Courses from "./pages/Courses";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import Login from "./pages/Login";

export default function App() {
  useEffect(() => {
    // Axios request interceptor to explicitly transform relative /api/ requests to absolute URLs
    // pointing directly to the resolved backend URL, bypassing any browser routing ambiguity on custom domains.
    const interceptor = axios.interceptors.request.use(
      (config) => {
        if (config.url && config.url.startsWith("/api/")) {
          const base = axios.defaults.baseURL || window.location.origin;
          const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
          config.url = `${cleanBase}${config.url}`;
          console.log(`[API Interceptor] Fully resolved target URL: ${config.url}`);
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    const resolveBackendUrl = async () => {
      try {
        const origin = window.location.origin;
        
        // 1. Determine base preflight defaults
        let activeBackendUrl = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
        if (origin.includes("ais-dev-")) {
          activeBackendUrl = "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
        }

        // 2. Load settings from Firestore first to dynamically discover the live backend URL
        try {
          const settingsSnap = await getDocFromServer(doc(db, "settings", "payment"));
          if (settingsSnap.exists()) {
            const sData = settingsSnap.data();
            if (sData && sData.backendApiUrl) {
              const savedUrl = sData.backendApiUrl.trim();
              if (savedUrl && savedUrl.length > 0) {
                const finalUrl = savedUrl.startsWith("http") ? savedUrl : `https://${savedUrl}`;
                // If it is a valid Google Cloud Run URL, use it as our activeBackendUrl
                if (finalUrl.includes(".run.app")) {
                  // If the saved URL is a development container, but the user is accessing from a non-dev environment,
                  // do NOT use it. Fall back to the stable 'ais-pre-' backend instead to prevent Network Errors for users.
                  if (finalUrl.includes("ais-dev-") && !origin.includes("ais-dev-")) {
                    console.log(`[API] Stored backend URL is a development sandbox, but user is on custom domain/preview. Keeping stable preview URL: ${activeBackendUrl}`);
                  } else {
                    activeBackendUrl = finalUrl;
                    console.log(`[API] Dynamically discovered live Backend Cloud Run URL: ${activeBackendUrl}`);
                  }
                }
              }
            }
          }
        } catch (dbErr) {
          console.warn("[API] Could not fetch settings directly from Firestore, using origin fallbacks:", dbErr);
        }

        const isLocalOrPreview = origin.includes("localhost") || 
                                origin.includes("127.0.0.1") || 
                                origin.includes("ais-pre-") || 
                                origin.includes("ais-dev-");

        // 3. Configure Axios default baseURL
        if (origin.includes("pyaresmmpanel.online")) {
          axios.defaults.baseURL = activeBackendUrl;
          console.log(`[API] Custom domain 'pyaresmmpanel.online' detected. Routing API requests directly to dynamically discovered backend: ${activeBackendUrl}`);
        } else if (!isLocalOrPreview || origin.includes("vercel") || origin.includes("netlify") || origin.includes("github.io")) {
          axios.defaults.baseURL = activeBackendUrl;
          console.log(`[API] External origin detected: ${origin}. Directly routing API requests to Backend: ${activeBackendUrl}`);
        } else {
          axios.defaults.baseURL = origin;
          console.log(`[API] Local/Preview origin detected. Axios baseURL set to: ${origin}`);
        }
      } catch (err) {
        console.error("[API] Dynamic backend resolution failed:", err);
      }
    };
    resolveBackendUrl();
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Courses />} />
          <Route path="courses" element={<Courses />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />
          <Route path="admin" element={<Admin />} />
          <Route path="login" element={<Login />} />
        </Route>
      </Routes>
    </Router>
  );
}


