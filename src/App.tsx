import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./features/theme/ThemeProvider";
import { RequireAuth } from "./features/navigation/RequireAuth";
import { AppShell } from "./features/app-shell/AppShell";
import PublicLayout from "./layouts/PublicLayout";
import AuthCallbackPage from "./pages/auth/AuthCallbackPage";
import AppHomePage from "./pages/app/AppHomePage";
import LibraryPage from "./pages/app/LibraryPage";
import RecallPage from "./pages/app/RecallPage";
import SessionsPage from "./pages/app/SessionsPage";
import SettingsPage from "./pages/app/SettingsPage";
import SetupPage from "./pages/app/SetupPage";
import LandingPage from "./pages/LandingPage";
import NotFoundPage from "./pages/NotFoundPage";

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
              <Route index element={<AppHomePage />} />
              <Route path="setup" element={<SetupPage />} />
              <Route path="recall" element={<RecallPage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ThemeProvider>
    </AuthProvider>
  );
}
