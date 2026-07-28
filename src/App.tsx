import { Suspense, lazy, type ReactNode } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { RequireAuth } from "./features/navigation/RequireAuth";
import { AppShell } from "./features/app-shell/AppShell";
import PublicLayout from "./layouts/PublicLayout";
import AuthCallbackPage from "./pages/auth/AuthCallbackPage";
import LandingPage from "./pages/LandingPage";
import NotFoundPage from "./pages/NotFoundPage";

// Authenticated pages load on demand so the unauthenticated landing and OAuth
// callback routes do not pay for them. `/` and `/auth/callback` stay eager.
const AppHomePage = lazy(() => import("./pages/app/AppHomePage"));
const LibraryPage = lazy(() => import("./pages/app/LibraryPage"));
const SessionsPage = lazy(() => import("./pages/app/SessionsPage"));
const UsagePage = lazy(() => import("./pages/UsagePage"));

function RouteFallback() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] items-center justify-center">
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      />
      <span className="sr-only">Loading page</span>
    </div>
  );
}

/**
 * Boundary sits at the outlet rather than around `AppShell`, so the shell chrome
 * stays rendered while a page chunk resolves.
 */
function SuspendedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <RouteErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}

function suspended(page: ReactNode): ReactNode {
  return <SuspendedRoute>{page}</SuspendedRoute>;
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/app" element={<AppShell />}>
              <Route index element={suspended(<AppHomePage />)} />
              <Route path="setup" element={suspended(<UsagePage view="setup" />)} />
              <Route path="recall" element={suspended(<UsagePage view="recall" />)} />
              <Route path="library" element={suspended(<LibraryPage />)} />
              <Route path="sessions" element={suspended(<SessionsPage />)} />
              <Route path="settings" element={suspended(<UsagePage view="settings" />)} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ThemeProvider>
    </AuthProvider>
  );
}
