import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";

export function RequireAuth() {
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
