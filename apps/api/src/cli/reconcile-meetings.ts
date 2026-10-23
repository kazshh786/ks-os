import 'dotenv/config';
import { CommunicationsMeetings } from '../modules/communications/communications.meetings.js';
const result=await new CommunicationsMeetings().reconcile(100);
console.log(JSON.stringify(result));
process.exit(0);
