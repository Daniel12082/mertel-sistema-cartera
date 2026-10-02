import { useState } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";

export default function PasswordField({ value, onChange, disabled, invalid }) {
  const [visible, setVisible] = useState(false);
  return <div className="login-field">
    <label htmlFor="login-password">Contraseña</label>
    <div className="login-input-wrap">
      <span className="login-input-icon"><LockKeyhole size={21} aria-hidden="true" /></span>
      <input id="login-password" name="password" type={visible ? "text" : "password"}
        placeholder="Ingresa tu contraseña" autoComplete="current-password" required
        value={value} onChange={onChange} disabled={disabled} aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "login-message" : undefined} />
      <button className="login-password-toggle" type="button" disabled={disabled}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible}
        onClick={() => setVisible(current => !current)}>
        {visible ? <EyeOff size={21} aria-hidden="true" /> : <Eye size={21} aria-hidden="true" />}
      </button>
    </div>
  </div>;
}
