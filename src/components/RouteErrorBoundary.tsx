import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";

type RouteErrorBoundaryProps = {
  children: ReactNode;
  onReload?: () => void;
};

type RouteErrorBoundaryState = {
  hasError: boolean;
};

function reloadPage() {
  window.location.reload();
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <div
            role="alert"
            className="max-w-md space-y-4 rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center"
          >
            <div className="space-y-2">
              <h1 className="text-lg font-semibold">Page failed to load</h1>
              <p className="text-sm text-muted-foreground">
                Check your connection, then reload to fetch the latest version of this page.
              </p>
            </div>
            <Button type="button" onClick={this.props.onReload ?? reloadPage}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
