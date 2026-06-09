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
    const origin = window.location.origin;
    
    // 1. Establish stable backup backend URLs
    const STABLE_API_URL = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
    const DEV_API_URL = "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
    
    let activeBackendUrl = STABLE_API_URL;
    if (origin.includes("ais-dev-") || origin.includes("localhost") || origin.includes("127.0.0.1")) {
      activeBackendUrl = DEV_API_URL;
    }

    const isLocalOrPreview = origin.includes("localhost") || 
                            origin.includes("127.0.0.1") || 
                            origin.includes("ais-pre-") || 
                            origin.includes("ais-dev-");

    // 2. STAGE 1 (Synchronous Setup): Pre-set Axios baseURL instantly
    if (origin.includes("pyaresmmpanel.online") || origin.includes("pyaresmmpanel.live")) {
      // Point directly to secure Cloud Run backend to avoid Vercel SPA html routing conflicts.
      // Dynamic CORS is fully enabled on the server, ensuring direct browser calls succeed.
      axios.defaults.baseURL = activeBackendUrl;
      console.log(`[API] [SYNC_INIT] Custom domain detected. Pointing directly to stable Cloud Run backend: ${activeBackendUrl}`);
    } else if (!isLocalOrPreview) {
      // Connect directly to secure Cloud Run backend
      axios.defaults.baseURL = activeBackendUrl;
      console.log(`[API] [SYNC_INIT] External domain detected. Pointing directly to Cloud Run backend: ${activeBackendUrl}`);
    } else if (origin.includes("vercel") || origin.includes("netlify") || origin.includes("github.io")) {
      // If hosted on raw vercel / netlify domains and didn't define a custom domain rule, use backup backend
      axios.defaults.baseURL = activeBackendUrl;
      console.log(`[API] [SYNC_INIT] Static hosting detected, setting stable backup backend: ${activeBackendUrl}`);
    } else {
      axios.defaults.baseURL = origin;
      console.log(`[API] [SYNC_INIT] Local preview environment, setting same-origin baseURL: ${origin}`);
    }

    // 3. Register request interceptor (must use current state of axios.defaults.baseURL)
    const interceptor = axios.interceptors.request.use(
      (config) => {
        if (config.url && config.url.startsWith("/api/")) {
          const base = axios.defaults.baseURL || activeBackendUrl;
          const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
          config.url = `${cleanBase}${config.url}`;
          console.log(`[API Interceptor] Fully resolved target URL: ${config.url}`);
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // 4. STAGE 2 (Asynchronous Lookup): Refresh activeBackendUrl if settings contain overrides
    const resolveBackendUrl = async () => {
      try {
        const settingsSnap = await getDocFromServer(doc(db, "settings", "payment"));
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
          if (sData && sData.backendApiUrl) {
            const savedUrl = sData.backendApiUrl.trim();
            if (savedUrl && savedUrl.length > 0) {
              const finalUrl = savedUrl.startsWith("http") ? savedUrl : `https://${savedUrl}`;
              // Verify it is a valid Google Cloud Run URL
              if (finalUrl.includes(".run.app")) {
                const isDevelopmentMode = origin.includes("ais-dev-") || origin.includes("localhost") || origin.includes("127.0.0.1");
                if (isDevelopmentMode) {
                  // Keep development sandbox URL to prevent shared database routing from matching production environment settings
                  activeBackendUrl = DEV_API_URL;
                  axios.defaults.baseURL = activeBackendUrl;
                  console.log(`[API] Dev sandbox environment detected. Locked to dev backend: ${activeBackendUrl}`);
                } else if (!isLocalOrPreview) {
                  // Direct connection to active Cloud Run backend for custom domains to avoid static index.html fallback
                  activeBackendUrl = finalUrl;
                  axios.defaults.baseURL = finalUrl;
                  console.log(`[API] [ASYNC_REFRESH] Custom domain detected. Pointing directly to active Cloud Run backend URL: ${finalUrl}`);
                } else {
                  activeBackendUrl = finalUrl;
                  axios.defaults.baseURL = activeBackendUrl;
                  console.log(`[API] [ASYNC_REFRESH] Updated Axios baseURL to Firestore configuration: ${activeBackendUrl}`);
                }
              }
            }
          }
        }
      } catch (dbErr) {
        console.warn("[API] Could not check live override in Firestore, running on stable synchronous defaults.", dbErr);
      }
    };
    resolveBackendUrl();

    return () => {
      axios.interceptors.request.eject(interceptor);
    };
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


