import React, { ErrorInfo, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong. Please try again later.";
      
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) {
          errorMessage = `Permission Denied: You don't have access to this ${parsed.operationType} operation on ${parsed.path}.`;
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
          <div className="p-4 bg-red-50 rounded-full">
            <AlertTriangle className="w-12 h-12 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Oops!</h2>
          <p className="text-gray-600 max-w-md">{errorMessage}</p>
          <Button 
            onClick={() => {
              try {
                localStorage.removeItem("cached_courses");
                localStorage.removeItem("cached_courses_time");
                localStorage.removeItem("cached_settings");
                localStorage.removeItem("cached_settings_time");
                localStorage.removeItem("cached_providers");
                localStorage.removeItem("cached_providers_time");
              } catch (e) {}
              window.location.reload();
            }}
            className="rounded-full px-8"
          >
            Reload Page
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
