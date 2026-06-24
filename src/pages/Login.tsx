import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { auth, googleProvider } from "@/lib/firebase";
import { signInWithPopup } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      navigate("/");
    }
  }, [user, loading, navigate]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success("Logged in successfully!");
      navigate("/");
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === 'auth/popup-blocked') {
        toast.error("Popup blocked by browser. Please allow popups for this site.");
      } else {
        toast.error(error.message || "Failed to sign in with Google");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 sm:p-12 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <Card className="border-none shadow-[0_20px_60px_-15px_rgba(0,0,0,0.08)] bg-white/90 backdrop-blur-xl rounded-[2.5rem]">
          <CardHeader className="p-8 pt-10 text-center space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-gray-900">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-gray-400 font-medium">
              Join thousands of users scaling their social presence daily.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-8 pt-0 space-y-6">
            <div className="space-y-4 py-2">
              <Button 
                variant="outline" 
                type="button"
                className="w-full h-14 rounded-2xl border-2 border-gray-150 hover:border-primary/20 hover:bg-primary/5 transition-all duration-300 flex items-center justify-center gap-3 group shadow-sm active:scale-95"
                onClick={handleGoogleLogin}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                ) : (
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.08H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.92l2.85-2.22c-.22-.67-.35-1.37-.35-2.1z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.08l3.66 2.84c.87-2.6 3.3-4.54 6.16-4.54z" fill="#EA4335" />
                  </svg>
                )}
                <span className="text-base font-bold text-gray-700 group-hover:text-primary transition-colors">
                  {isLoading ? "Connecting..." : "Continue with Google"}
                </span>
              </Button>
            </div>

            <p className="text-center text-[11px] text-gray-400 font-medium px-4">
              By continuing, you agree to our Terms of Service and Privacy Policy. All logins are safely routed through secure SSL.
            </p>
          </CardContent>
        </Card>

        <div className="mt-12 text-center">
          <p className="text-gray-400 text-sm font-medium">
            Having trouble? <a href="#" className="text-primary font-bold hover:underline">Contact Support</a>
          </p>
        </div>
      </div>
    </div>
  );
}
