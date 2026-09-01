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
  const host = window.location.hostname;
  
  // If running inside Google Cloud Run container or local dev server
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".run.app") ||
    host.includes("googleusercontent.com") ||
    host.includes("webcontainer.io")
  ) {
    return "";
  }
  
  // When accessed via custom domain (e.g. smmpanel.online, Vercel, Netlify, etc.)
  return STABLE_CLOUD_RUN_BACKEND;
}

// Global setup for axios base URL and request/response interceptors
axios.defaults.baseURL = getApiBaseUrl();

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
  async (error) => {
    const originalRequest = error.config;
    // If a request failed with 405 Method Not Allowed, 404, or HTML response on custom domain or relative URL, retry against Cloud Run backend
    if (
      originalRequest &&
      !originalRequest._retry &&
      (error.response?.status === 405 || error.response?.status === 404 || error.message?.includes("Received HTML") || !error.response)
    ) {
      originalRequest._retry = true;
      if (!originalRequest.baseURL || !originalRequest.baseURL.includes("run.app")) {
        console.warn(`[AXIOS-FALLBACK] Retrying ${originalRequest.url} against Cloud Run backend...`);
        originalRequest.baseURL = STABLE_CLOUD_RUN_BACKEND;
        axios.defaults.baseURL = STABLE_CLOUD_RUN_BACKEND;
        return axios(originalRequest);
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



