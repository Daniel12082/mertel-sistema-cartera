import {useState} from 'react';
import {Link,useLocation} from 'react-router-dom';
import api from '../../services/api';
import logo from '../../assets/login/mertel-logo.png';
import './Login.css';
export default function PasswordRecovery({reset=false}){
  const location=useLocation(),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false);
  const token=new URLSearchParams(location.hash.slice(1)).get('token');
  async function submit(event){event.preventDefault();if(busy)return;setError('');setMessage('');if(reset&&password!==confirmation){setError('Las contraseñas no coinciden.');return;}setBusy(true);try{const {data}=await api.post('/auth/'+(reset?'reset-password':'forgot-password'),reset?{token,password}:{email:email.trim()},{skipAuth:true});setDone(true);setPassword('');setConfirmation('');setMessage(reset?'Contraseña actualizada. Ya puedes iniciar sesión con tu nueva contraseña.':data.data.message);}catch(failure){setError([400,429,503].includes(failure.response?.status)?failure.response.data?.message:'No se pudo completar la solicitud. Intenta nuevamente.');}finally{setBusy(false);}}
  return <main className="login-screen"><section className="login-form-panel" style={{maxWidth:520,width:'100%',background:'white',borderRadius:12}}><img className="login-form-logo" src={logo} alt="MERTEL"/><header className="login-welcome"><h1>{reset?'Nueva contraseña':'Olvidé mi contraseña'}</h1><p>{reset?'Elige una contraseña nueva para tu cuenta.':'Te enviaremos un enlace al correo registrado en tu cuenta.'}</p></header>
    {reset&&!token?<p role="alert">El enlace no es válido. <Link to="/olvide-contrasena">Solicitar otro enlace</Link></p>:!done&&<form className="login-form" onSubmit={submit}>
      {reset?<><label className="login-field">Nueva contraseña<div className="login-input-wrap"><input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></div></label><label className="login-field">Confirmar nueva contraseña<div className="login-input-wrap"><input type="password" required minLength={8} autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy}/></div></label></>:<label className="login-field">Correo electrónico<div className="login-input-wrap"><input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></div></label>}
      <button className="login-submit" disabled={busy}>{busy?'Procesando…':reset?'Guardar nueva contraseña':'Enviar enlace de recuperación'}</button>
    </form>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}{done&&!reset&&<button type="button" onClick={()=>{setDone(false);setMessage('');}}>Usar otro correo</button>}<p><Link to="/login">Volver a iniciar sesión</Link></p>
  </section></main>;
}
