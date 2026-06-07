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
        const activeBackendUrl = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";
        
        // Let's check if the current origin is a local test environment or developer preview
        const isLocalOrPreview = origin.includes("localhost") || 
                                origin.includes("127.0.0.1") || 
                                origin.includes("ais-pre-") || 
                                origin.includes("ais-dev-");
        
        // 1. Initial base URL fallback
        if (origin.includes("pyaresmmpanel.online")) {
          // Route API requests directly to Cloud Run backend to prevent Vercel's 10-second timeout limit
          // on long-running SMM provider API requests.
          axios.defaults.baseURL = activeBackendUrl;
          console.log(`[API] Custom domain 'pyaresmmpanel.online' detected. Routing API requests directly to Backend Cloud Run: ${activeBackendUrl}`);
        } else if (!isLocalOrPreview || origin.includes("vercel") || origin.includes("netlify") || origin.includes("github.io")) {
          // If accessing from a custom domain (like pyaresmmpanel.online) or a static host (like vercel, netlify),
          // we MUST call the active Google Cloud Run backend directly to process API calls correctly.
          axios.defaults.baseURL = activeBackendUrl;
          console.log(`[API] Custom domain/external origin detected: ${origin}. Directly routing API requests to Backend Cloud Run: ${activeBackendUrl}`);
        } else {
          // If on localhost or native preview server, handle its own API calls locally
          axios.defaults.baseURL = origin;
          console.log(`[API] Local/Preview origin detected. Axios baseURL set to: ${origin}`);
        }
        
        // 2. Load custom backend settings dynamically from Firestore if configured
        const settingsSnap = await getDocFromServer(doc(db, "settings", "payment"));
        if (settingsSnap.exists()) {
          const sData = settingsSnap.data();
          if (sData && sData.backendApiUrl) {
            const savedUrl = sData.backendApiUrl.trim();
            if (savedUrl && savedUrl.length > 0) {
              const finalUrl = savedUrl.startsWith("http") ? savedUrl : `https://${savedUrl}`;
              
              // If the saved URL is a custom domain, or contains 'ais-dev' (development sandbox),
              // we should NOT override baseURL with it, because custom domains only host static files,
              // and the 'ais-dev' URL is a transient development environment which goes offline when the tab closes.
              // Note: If the current origin is already the customer's custom domain, we allow using it!
              const isSavedUrlCustomDomain = (finalUrl.includes("pyaresmmpanel.online") && !origin.includes("pyaresmmpanel.online")) || 
                                             finalUrl.includes("ais-dev-") ||
                                             (!finalUrl.includes(".run.app") && !finalUrl.includes("localhost") && !finalUrl.includes("127.0.0.1") && !finalUrl.includes(origin.replace("https://", "").replace("http://", "")));
              
              if (!isSavedUrlCustomDomain || origin.includes("pyaresmmpanel.online")) {
                const targetUrl = origin.includes("pyaresmmpanel.online") ? activeBackendUrl : finalUrl;
                // Override baseURL if different from current configuration
                if (axios.defaults.baseURL !== targetUrl) {
                  axios.defaults.baseURL = targetUrl;
                  console.log(`[API] Base URL configured to saved custom backend: ${targetUrl}`);
                }
              } else {
                console.log(`[API] Saved URL in database (${finalUrl}) points to a custom domain. Keeping active backend instead: ${axios.defaults.baseURL}`);
              }
            }
          }
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


