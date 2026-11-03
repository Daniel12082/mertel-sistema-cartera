// Browser-only simulation must never reach real authentication, readers or writers.
// Normal requests, permissions and financial services are untouched.
export function rejectSimulationRequests(req, res, next) {
  const flag = String(req.get('X-Mertel-Simulation') || '').trim().toLowerCase();
  if (req.method !== 'OPTIONS' && ['true', '1', 'simulation'].includes(flag)) {
    return res.status(409).json({ success: false, code: 'SIMULATION_LOCAL_ONLY', message: 'La simulación utiliza únicamente datos locales. No se ejecutó ninguna operación en MERTEL.' });
  }
  return next();
}
