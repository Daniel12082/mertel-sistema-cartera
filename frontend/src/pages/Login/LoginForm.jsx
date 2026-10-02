import { useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import PasswordField from "./PasswordField";

export default function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    if (!email.trim() || !password) {
      setInvalid(true); setMessage("Ingresa tu correo electrónico y contraseña."); return;
    }
    submitting.current = true;
    setLoading(true); setMessage(""); setInvalid(false);
    try {
      await login(email.trim(), password);
      setPassword("");
      setMessage("Sesión iniciada. Bienvenido a MERTEL.");
    } catch (error) {
      const status = error.response?.status;
      setInvalid(status === 401);
      setMessage(status === 401 ? "Correo o contraseña incorrectos." :
        status === 429 ? "Demasiados intentos. Espera unos minutos e intenta nuevamente." :
        "No fue posible conectar con el servidor. Intenta nuevamente.");
    } finally { submitting.current = false; setLoading(false); }
  }
  return <form className="login-form" onSubmit={submit} aria-busy={loading}>
    <div className="login-field">
      <label htmlFor="login-email">Correo electrónico</label>
      <div className="login-input-wrap">
        <span className="login-input-icon"><Mail size={21} aria-hidden="true" /></span>
        <input id="login-email" name="email" type="email" placeholder="Ingresa tu correo electrónico"
          autoComplete="username" autoCapitalize="none" spellCheck="false" required
          value={email} onChange={event => setEmail(event.target.value)} disabled={loading}
          aria-invalid={invalid || undefined} aria-describedby={invalid ? "login-message" : undefined} />
      </div>
    </div>
    <PasswordField value={password} onChange={event => setPassword(event.target.value)} disabled={loading} invalid={invalid} />
    <div id="login-message" className="login-message" role={invalid ? "alert" : "status"} aria-live="polite">{message}</div>
    <button className="login-submit" type="submit" disabled={loading}>
      {loading ? <><LoaderCircle className="login-spinner" size={21} aria-hidden="true" /> Iniciando sesión...</> :
        <>Iniciar sesión <ArrowRight size={23} aria-hidden="true" /></>}
    </button>
    <p className="login-security"><ShieldCheck size={21} aria-hidden="true" /><span>Acceso exclusivo para personal autorizado</span></p>
  </form>;
}
