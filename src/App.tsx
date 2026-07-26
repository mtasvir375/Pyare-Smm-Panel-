/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import axios from "axios";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Courses from "./pages/Courses";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import LandingPage from "./pages/LandingPage";

export const CLOUD_RUN_BACKENDS = [
  "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app",
  "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app"
];

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return CLOUD_RUN_BACKENDS[0];
  const host = window.location.hostname;
  if (host.endsWith(".run.app") || host === "localhost" || host === "127.0.0.1") {
    return window.location.origin;
  }
  return CLOUD_RUN_BACKENDS[0];
}

// Global setup for axios base URL and fallback interceptor
const initialBaseUrl = getApiBaseUrl();
axios.defaults.baseURL = initialBaseUrl;

axios.interceptors.response.use(
  (response) => {
    // If an HTML SPA page is returned instead of JSON for an API endpoint (e.g. Vercel 404 fallback), treat as error
    if (typeof response.data === "string" && response.data.includes("<!DOCTYPE")) {
      return Promise.reject(new Error("Received HTML instead of JSON from API endpoint"));
    }
    return response;
  },
  async (error) => {
    const config = error.config;
    if (!config || config._retry) {
      return Promise.reject(error);
    }

    const isHtmlErr = typeof error.response?.data === "string" && error.response.data.includes("<!DOCTYPE");
    const isNetworkOr404 = !error.response || error.response.status === 404 || isHtmlErr;

    // If request failed on Vercel or custom domain, attempt fallback directly to Cloud Run backends
    if (isNetworkOr404) {
      config._retry = true;
      for (const backendUrl of CLOUD_RUN_BACKENDS) {
        if (!config.url?.startsWith("http") || !config.url.startsWith(backendUrl)) {
          try {
            const path = config.url?.startsWith("/") ? config.url : `/${config.url || ""}`;
            const targetUrl = `${backendUrl}${path}`;
            console.log(`[AXIOS INTERCEPTOR] Retrying failed request to target URL: ${targetUrl}`);
            const retryRes = await axios({ ...config, url: targetUrl });
            if (retryRes && (typeof retryRes.data !== "string" || !retryRes.data.includes("<!DOCTYPE"))) {
              return retryRes;
            }
          } catch (retryErr) {
            console.warn(`[AXIOS INTERCEPTOR] Retry failed on ${backendUrl}:`, retryErr);
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

export default function App() {
  useEffect(() => {
    const baseUrl = getApiBaseUrl();
    axios.defaults.baseURL = baseUrl;
    console.log(`[API] Base URL initialized to: ${baseUrl} (Host: ${window.location.hostname})`);
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
          <Route path="p/:slug" element={<LandingPage />} />
        </Route>
      </Routes>
    </Router>
  );
}



