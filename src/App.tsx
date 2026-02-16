import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import AppLayout from "./layouts/AppLayout";
import AuthCallbackPage from "./pages/auth/AuthCallbackPage";
import LandingPage from "./pages/LandingPage";
import UsagePage from "./pages/UsagePage";

export default function App() {
  return (
    <AuthProvider>
      <AppLayout>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<UsagePage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </AppLayout>
    </AuthProvider>
  );
}
