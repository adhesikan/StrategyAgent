import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-start justify-center p-6">
          <div className="max-w-xl w-full rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-5 space-y-3" data-testid="error-boundary-fallback">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="text-sm font-semibold">
                {this.props.fallbackTitle ?? "Something went wrong rendering this page"}
              </h2>
            </div>
            <p className="text-xs text-amber-900/80 dark:text-amber-200/80 font-mono break-words">
              {this.state.error.message}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => this.setState({ error: null })}
                data-testid="button-error-retry"
              >
                Try again
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.history.back()}
                data-testid="button-error-back"
              >
                Go back
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
