import { Suspense, lazy, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
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
const RecallPage = lazy(() => import("./pages/app/RecallPage"));
const SessionsPage = lazy(() => import("./pages/app/SessionsPage"));
const SettingsPage = lazy(() => import("./pages/app/SettingsPage"));
const SetupPage = lazy(() => import("./pages/app/SetupPage"));

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
function suspended(page: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{page}</Suspense>;
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
              <Route path="setup" element={suspended(<SetupPage />)} />
              <Route path="recall" element={suspended(<RecallPage />)} />
              <Route path="library" element={suspended(<LibraryPage />)} />
              <Route path="sessions" element={suspended(<SessionsPage />)} />
              <Route path="settings" element={suspended(<SettingsPage />)} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ThemeProvider>
    </AuthProvider>
  );
}
