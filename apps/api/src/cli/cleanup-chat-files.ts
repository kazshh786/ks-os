import 'dotenv/config';
import { CommunicationsService } from '../modules/communications/communications.service.js';
// Operator-run maintenance; no production scheduler is provisioned by this phase.
const result=await new CommunicationsService().attachments.cleanup(100);
console.log(JSON.stringify(result));
process.exit(0);
