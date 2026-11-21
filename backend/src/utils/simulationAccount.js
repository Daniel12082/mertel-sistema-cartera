// Reserved classification, never an operational permission grant.
export const SIMULATION_ROLE = 'simulation';
export const isSimulationAccount = (roles = []) => roles.some(role => role.name === SIMULATION_ROLE);
