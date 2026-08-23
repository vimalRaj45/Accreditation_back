import { authenticate } from '../middleware/auth.js';
import { calculateHospitalReadiness } from '../services/scoringService.js';

export default async function scoringRoutes(fastify, options) {
  fastify.addHook('preHandler', authenticate);

  // Get current readiness and compliance metrics
  fastify.get('/readiness', async (request, reply) => {
    const hospitalId = request.user.hospital_id || 1;
    const readinessData = await calculateHospitalReadiness(hospitalId);
    return readinessData;
  });
}
