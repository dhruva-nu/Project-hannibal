import { lazy, Suspense, type ReactNode, useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { HttpAgent } from "@ag-ui/client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { FeatureFlagProvider } from "@/context/FeatureFlagContext";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary/ErrorBoundary";
import { Spinner } from "@/shared/components/atoms";
import { useCopilotNav } from "@/hooks/useCopilotNav";

const Login = lazy(() => import("@/pages/Login/Login").then((m) => ({ default: m.Login })));
const Home = lazy(() => import("@/pages/Home/Home").then((m) => ({ default: m.Home })));
const Courses = lazy(() => import("@/pages/Courses/Courses").then((m) => ({ default: m.Courses })));
const Storyboard = lazy(() => import("@/pages/Storyboard/Storyboard").then((m) => ({ default: m.Storyboard })));
const DesignBoard = lazy(() => import("@/pages/DesignBoard/DesignBoard").then((m) => ({ default: m.DesignBoard })));
const CoursePage = lazy(() => import("@/pages/CoursePage/CoursePage").then((m) => ({ default: m.CoursePage })));

const AGENT_URL = import.meta.env.VITE_COPILOTKIT_RUNTIME_URL ?? "/api/v1/copilotkit";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="checking session…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <ErrorBoundary>{children}</ErrorBoundary>;
};

const CopilotShell = ({ children }: { children: ReactNode }) => {
  useCopilotNav();
  return <>{children}</>;
};

function App() {
  const agents = useMemo(
    () => ({ default: new HttpAgent({ url: AGENT_URL }) }),
    [],
  );

  return (
    <BrowserRouter>
      <AuthProvider>
        <FeatureFlagProvider>
          <CopilotKit runtimeUrl={AGENT_URL} agents__unsafe_dev_only={agents} agent="default">
            <CopilotShell>
            <ErrorBoundary>
              <Suspense fallback={<Spinner />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route
                    path="/home"
                    element={
                      <ProtectedRoute>
                        <Home />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/courses" element={<ProtectedRoute><Courses /></ProtectedRoute>} />
                  <Route path="/storyboard" element={<ProtectedRoute><Storyboard /></ProtectedRoute>} />
                  <Route path="/design-board" element={<ProtectedRoute><DesignBoard /></ProtectedRoute>} />
                  <Route path="/courses/:courseId" element={<ProtectedRoute><CoursePage /></ProtectedRoute>} />
                  <Route path="/" element={<Navigate to="/home" replace />} />
                  <Route path="*" element={<Navigate to="/home" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
            <CopilotPopup
              labels={{
                title: "Hannibal AI",
                initial: "Hi! How can I help you today?",
              }}
            />
            </CopilotShell>
          </CopilotKit>
        </FeatureFlagProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
