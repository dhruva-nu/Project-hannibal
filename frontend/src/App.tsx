import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Login } from "@/pages/Login/Login";
import { Home } from "@/pages/Home/Home";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
