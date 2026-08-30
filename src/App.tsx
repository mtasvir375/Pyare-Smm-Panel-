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
import { auth } from "@/lib/firebase";

export const STABLE_CLOUD_RUN_BACKEND = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export const CLOUD_RUN_BACKENDS = [
  STABLE_CLOUD_RUN_BACKEND
];

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return STABLE_CLOUD_RUN_BACKEND;
  const host = window.location.hostname.toLowerCase();
  // If hosted on Cloud Run or Localhost, use current origin
  if (host.includes("run.app") || host.includes("localhost") || host.includes("127.0.0.1") || host.includes("webcontainer") || host.includes("ais-dev") || host.includes("ais-pre")) {
    return window.location.origin;
  }
  // When visited directly on custom domain (e.g. pyaresmmpanel.online), route backend API calls directly to Cloud Run
  return STABLE_CLOUD_RUN_BACKEND;
}

// Global setup for axios base URL and request/response interceptors
axios.defaults.baseURL = typeof window !== "undefined" ? getApiBaseUrl() : STABLE_CLOUD_RUN_BACKEND;

axios.interceptors.request.use(
  async (config) => {
    if (typeof window !== "undefined") {
      if (auth.currentUser && !config.headers?.Authorization) {
        try {
          const token = await auth.currentUser.getIdToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        } catch (e) {}
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

axios.interceptors.response.use(
  (response) => {
    // If an HTML SPA page is returned instead of JSON for an API endpoint (e.g. Vercel/Firebase 404 fallback), treat as error
    if (typeof response.data === "string" && response.data.includes("<!DOCTYPE")) {
      return Promise.reject(new Error("Received HTML instead of JSON from API endpoint"));
    }
    return response;
  },
  (error) => Promise.reject(error)
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



