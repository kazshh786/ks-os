import type { FastifyPluginAsync } from 'fastify';
import posRoutes from './pos.routes.js';
import inventoryRoutes from './inventory.routes.js';
import retailPosRoutes from './retail-pos.routes.js';

const routes: FastifyPluginAsync = async fastify => {
  await fastify.register(posRoutes);
  await fastify.register(inventoryRoutes);
  await fastify.register(retailPosRoutes);
};

export default routes;
