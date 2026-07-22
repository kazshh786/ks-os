import type{AuthContext}from'../../plugins/auth.js';import{teamError}from'./team.errors.js';
export function requireOwner(auth:AuthContext){if(auth.role!=='owner')throw teamError(403,'TEAM_ACCESS_DENIED','Owner access is required.');return{tenantId:auth.tenantId,userId:auth.tenantUserId,authUserId:auth.authUserId};}
