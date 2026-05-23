import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot, updateDoc, increment } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  isAdmin: boolean;
  isPaymentAdmin: boolean;
  isInstructor: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  isPaymentAdmin: false,
  isInstructor: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      if (!firebaseUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      // If it's a known admin, we can stop loading early to show the dashboard shell
      if (firebaseUser.email === "mtasvir375@gmail.com" || firebaseUser.email === "mdsaudalam621@gmail.com") {
        setLoading(false);
        // Set temporary profile to allow immediate access to restricted pages
        setProfile({ 
          email: firebaseUser.email, 
          role: firebaseUser.email === "mtasvir375@gmail.com" ? "admin" : "payment_admin" 
        });
      }

      const userDocRef = doc(db, "users", firebaseUser.uid);
      
      try {
        // Initial check and creation
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) {
          const role = firebaseUser.email === "mtasvir375@gmail.com" ? "admin" : "student";
          
          const newProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            role: role,
            balance: 1,
            createdAt: serverTimestamp(),
          };
          await setDoc(userDocRef, newProfile);
          
          // Increment total users counter efficiently
          try {
            const statsRef = doc(db, "stats", "counters");
            await setDoc(statsRef, { totalUsers: increment(1) }, { merge: true });
          } catch (e) {
            console.error("Error updating user stats:", e);
          }
        } else {
          const data = userDoc.data();
          if (firebaseUser.email === "mtasvir375@gmail.com" && data.role !== "admin") {
            setDoc(userDocRef, { role: "admin" }, { merge: true });
          }
        }

        // Real-time listener for profile (balance, etc.)
        if (unsubscribeProfile) unsubscribeProfile();
        unsubscribeProfile = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setProfile(doc.data());
          }
        });

        // Update last active timestamp - Throttled significantly
        const lastActiveUpdated = localStorage.getItem(`lastActive_${firebaseUser.uid}`);
        const now = Date.now();
        // Only update once every 24 hours to save writes
        if (!lastActiveUpdated || now - parseInt(lastActiveUpdated) > 24 * 60 * 60 * 1000) { 
          try {
            // Don't await this, it's not critical for the app to start
            setDoc(userDocRef, { lastActive: serverTimestamp() }, { merge: true });
            localStorage.setItem(`lastActive_${firebaseUser.uid}`, now.toString());
          } catch(e) {}
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProfile();
    };
  }, []);

  const value = React.useMemo(() => ({
    user,
    profile,
    loading,
    isAdmin: profile?.role === "admin" || user?.email === "mtasvir375@gmail.com",
    isPaymentAdmin: user?.email?.toLowerCase() === "mdsaudalam621@gmail.com",
    isInstructor: profile?.role === "instructor" || profile?.role === "admin" || user?.email === "mtasvir375@gmail.com",
  }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
