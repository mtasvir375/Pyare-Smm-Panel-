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

const activeBackendUrl = "https://ais-pre-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export default function App() {
  useEffect(() => {
    const origin = window.location.origin;
    
    // Check if the current origin is a local dev environment or the native Cloud Run instance.
    // If it's a custom domain or hosted on Vercel, we MUST point to activeBackendUrl directly,
    // otherwise relative requests to /api/ will hit Vercel's static router and result in 404 errors.
    const isNativeHost = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("-523409699457");
    axios.defaults.baseURL = isNativeHost ? origin : activeBackendUrl;
    console.log(`[API] [SYNC_INIT] Base URL set to: ${axios.defaults.baseURL} (origin: ${origin})`);
    
    return () => {};
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


