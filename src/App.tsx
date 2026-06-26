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

const activeBackendUrl = "https://ais-dev-n2umeaxvo6qnc7chsbm27z-523409699457.asia-southeast1.run.app";

export default function App() {
  useEffect(() => {
    const origin = window.location.origin;
    
    // Use origin for baseURL to support relative paths and proxying (e.g. via Vercel/Custom Domain)
    axios.defaults.baseURL = origin;
    console.log(`[API] [SYNC_INIT] Base URL set to origin: ${origin}`);

    // No need for interceptor if we use baseURL correctly with relative paths
    
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
        </Route>
      </Routes>
    </Router>
  );
}


