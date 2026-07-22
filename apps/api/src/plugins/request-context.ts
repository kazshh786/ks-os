import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    user?: {
      id: string;
      email: string;
      role: string;
    };
    correlationId?: string;
  }
}

async function registerRequestContext(fastify: FastifyInstance) {
  fastify.decorateRequest('tenantId', null);
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('correlationId', null);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const supplied=request.headers['x-correlation-id'];
    request.correlationId=typeof supplied==='string'&&/^[A-Za-z0-9._:-]{1,100}$/.test(supplied)?supplied:request.id;
    reply.header('x-request-id',request.id).header('x-correlation-id',request.correlationId).header('cache-control','no-store');
  });
  fastify.addHook('onResponse',async(request,reply)=>{request.log.info({service:'ks-os-api',environment:process.env.NODE_ENV||'development',requestId:request.id,correlationId:request.correlationId,tenantId:request.auth?.tenantId,agencyUserId:request.agencyAuth?.agencyUserId,route:request.routeOptions.url,method:request.method,statusCode:reply.statusCode,durationMs:Math.round(reply.elapsedTime)},'request completed');});
}

export default fp(registerRequestContext,{name:'request-context'});
