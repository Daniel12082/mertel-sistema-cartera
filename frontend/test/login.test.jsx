import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../src/auth/auth.context";
import LoginPage from "../src/pages/Login/LoginPage";
import ProtectedRoute from "../src/auth/ProtectedRoute";
import SessionActions from "../src/auth/SessionActions";

function view(auth = {}, path = "/login") {
  const value = { user: null, initializing: false, login: vi.fn(), logout: vi.fn(), ...auth };
  render(<AuthContext.Provider value={value}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}><Route path="/" element={<><h1>Sistema principal</h1><SessionActions /></>} /></Route>
  </Routes></MemoryRouter></AuthContext.Provider>);
  return value;
}
async function fill() {
  const actions = userEvent.setup();
  await actions.type(screen.getByLabelText("Correo electrónico"), "personal@example.com");
  await actions.type(screen.getByLabelText("Contraseña"), "password");
  return actions;
}
describe("MERTEL login", () => {
  it("requires both fields and provides associated labels", () => {
    const { login } = view();
    expect(screen.getByLabelText("Correo electrónico")).toBeRequired(); expect(screen.getByLabelText("Contraseña")).toBeRequired();
    fireEvent.submit(screen.getByRole("button", { name: "Iniciar sesión" }).closest("form"));
    expect(login).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("Ingresa tu correo");
  });
  it("shows and hides the password accessibly", async () => {
    view(); const actions = userEvent.setup();
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
    await actions.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    await actions.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "password");
  });
  it("prevents double submit and displays loading then success", async () => {
    let finish; const login = vi.fn(() => new Promise(resolve => { finish = resolve; })); view({ login });
    const actions = await fill(); await actions.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(screen.getByRole("button", { name: "Iniciando sesión..." })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Contraseña").closest("form")); expect(login).toHaveBeenCalledTimes(1);
    finish(); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sesión iniciada"));
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
  });
  it.each([
    [{ response: { status: 401 } }, "Correo o contraseña incorrectos."],
    [new Error("SQL or internal details"), "No fue posible conectar con el servidor. Intenta nuevamente."],
    [{ response: { status: 429 } }, "Demasiados intentos."],
  ])("shows safe error messages", async (failure, text) => {
    view({ login: vi.fn().mockRejectedValue(failure) }); const actions = await fill();
    await actions.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByText(text, { exact: false })).toBeVisible();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeEnabled();
  });
  it("redirects an unauthenticated user to login", () => { view({}, "/"); expect(screen.getByText("Bienvenido")).toBeVisible(); });
  it("allows an authenticated user into the existing principal route", () => { view({ user: { name: "Personal" } }, "/"); expect(screen.getByText("Sistema principal")).toBeVisible(); });
  it("redirects an authenticated user away from login", () => { view({ user: { name: "Personal" } }); expect(screen.getByText("Sistema principal")).toBeVisible(); });
  it("waits for bootstrap without flashing the protected content", () => { view({ initializing: true }, "/"); expect(screen.getByRole("status")).toHaveTextContent("Verificando sesión"); });
  it("calls the existing logout operation", async () => {
    const logout = vi.fn().mockResolvedValue(); view({ user: { name: "Personal" }, logout }, "/");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" })); expect(logout).toHaveBeenCalledTimes(1);
  });
});
