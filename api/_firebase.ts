import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyBW_IUbuocn83oBCfQfbZsGbswo-OcgxRY",
  authDomain: "gen-lang-client-0629912823.firebaseapp.com",
  projectId: "gen-lang-client-0629912823",
  storageBucket: "gen-lang-client-0629912823.firebasestorage.app",
  messagingSenderId: "507845696919",
  appId: "1:507845696919:web:ded6d1b5cf1f802770b8d2",
  measurementId: "G-PYFG8F7M97"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, "ai-studio-f36429fa-50a3-4e58-b960-86b1e1d0141c");
