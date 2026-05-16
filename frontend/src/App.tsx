import { type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Login } from "@/pages/Login/Login";
import { Home } from "@/pages/Home/Home";
import { Courses } from "@/pages/Courses/Courses";
import { Storyboard } from "@/pages/Storyboard/Storyboard";
import { DesignBoard } from "@/pages/DesignBoard/DesignBoard";
import { CoursePage } from "@/pages/CoursePage/CoursePage";

const RUNTIME_URL = import.meta.env.VITE_COPILOTKIT_RUNTIME_URL ?? "/api/v1/copilotkit";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CopilotKit runtimeUrl={RUNTIME_URL} useSingleEndpoint={false}>
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
        </CopilotKit>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
