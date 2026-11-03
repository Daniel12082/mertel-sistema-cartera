import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import AuthProvider from "./auth/AuthProvider.jsx";
import SimulationProvider from './simulation/SimulationProvider.jsx';
import AppearanceProvider from './appearance/AppearanceProvider.jsx';

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><SimulationProvider><AppearanceProvider><App /></AppearanceProvider></SimulationProvider></AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
