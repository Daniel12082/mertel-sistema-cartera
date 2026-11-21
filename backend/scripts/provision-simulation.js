import 'dotenv/config';
import pool from '../src/config/database.js';
import { provisionSimulationAccount } from '../src/services/simulationAccount.service.js';

// Accept credentials through stdin, never command-line arguments or logs.
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 8192) throw new Error('Entrada demasiado grande.');
  }
  console.log(JSON.stringify(await provisionSimulationAccount(JSON.parse(input))));
} catch {
  console.error('No se pudo crear la cuenta de simulación. No se modificaron cuentas existentes.');
  process.exitCode = 1;
} finally { await pool.end(); }
