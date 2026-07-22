import{createClient}from'@supabase/supabase-js';import{teamError}from'./team.errors.js';
export class SupabaseAdminAdapter{private client;constructor(){const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw teamError(502,'TEAM_INVITATION_SEND_FAILED','Invitation delivery is not configured.');this.client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});}
 async invite(email:string){const origin=process.env.TEAM_INVITE_REDIRECT_URL;if(!origin)throw teamError(502,'TEAM_INVITATION_SEND_FAILED','Invitation redirect is not configured.');const{data,error}=await this.client.auth.admin.inviteUserByEmail(email,{redirectTo:origin});if(error)throw teamError(502,'TEAM_INVITATION_SEND_FAILED','The invitation could not be sent.');return data.user.id;}
 async resend(email:string){return this.invite(email);}
}
