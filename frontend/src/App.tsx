import { type ReactNode, useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { HttpAgent } from "@ag-ui/client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Login } from "@/pages/Login/Login";
import { Home } from "@/pages/Home/Home";
import { Courses } from "@/pages/Courses/Courses";
import { Storyboard } from "@/pages/Storyboard/Storyboard";
import { DesignBoard } from "@/pages/DesignBoard/DesignBoard";
import { CoursePage } from "@/pages/CoursePage/CoursePage";
import { useCopilotNav } from "@/hooks/useCopilotNav";

const AGENT_URL = import.meta.env.VITE_COPILOTKIT_RUNTIME_URL ?? "/api/v1/copilotkit";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
        <CopilotKit runtimeUrl={AGENT_URL} agents__unsafe_dev_only={agents} agent="default">
          <CopilotShell>
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
            <CopilotPopup
              labels={{
                title: "Hannibal AI",
                initial: "Hi! How can I help you today?",
              }}
            />
          </CopilotShell>
        </CopilotKit>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
