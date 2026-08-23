import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import { initDb } from './config/db.js';
import { seedDatabase } from './db/seed.js';
import { initAlertsCron } from './services/cronAlerts.js';

// Route Imports
import authRoutes from './routes/auth.routes.js';
import hospitalRoutes from './routes/hospitals.routes.js';
import departmentRoutes from './routes/departments.routes.js';
import userRoutes from './routes/users.routes.js';
import requirementRoutes from './routes/requirements.routes.js';
import kpiRoutes from './routes/kpis.routes.js';
import auditRoutes from './routes/audits.routes.js';
import correctiveActionRoutes from './routes/correctiveActions.routes.js';
import documentRoutes from './routes/documents.routes.js';
import alertRoutes from './routes/alerts.routes.js';
import scoringRoutes from './routes/scoring.routes.js';
import aiRoutes from './routes/ai.routes.js';
import reportRoutes from './routes/reports.routes.js';

dotenv.config();

const fastify = Fastify({
  logger: true,
  bodyLimit: 30 * 1024 * 1024 // 30MB body limit
});

// Support empty body for POST/PUT requests with application/json
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
  try {
    const json = (body && body.trim().length > 0) ? JSON.parse(body) : {};
    done(null, json);
  } catch (err) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

async function startServer() {
  try {
    // 1. Register Plugins
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    });

    await fastify.register(jwt, {
      secret: process.env.JWT_SECRET || 'hospital_accreditation_compliance_jwt_secret_key_2026_secure'
    });

    await fastify.register(multipart, {
      limits: {
        fileSize: 25 * 1024 * 1024 // 25MB max per document
      }
    });

    // 2. Health check route
    fastify.get('/api/health', async () => {
      return {
        status: 'online',
        service: 'Hospital Accreditation & Compliance Management System API',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };
    });

    // 3. Register Core API Routes
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(hospitalRoutes, { prefix: '/api/hospitals' });
    await fastify.register(departmentRoutes, { prefix: '/api/departments' });
    await fastify.register(userRoutes, { prefix: '/api/users' });
    await fastify.register(requirementRoutes, { prefix: '/api/requirements' });
    await fastify.register(kpiRoutes, { prefix: '/api/kpis' });
    await fastify.register(auditRoutes, { prefix: '/api/audits' });
    await fastify.register(correctiveActionRoutes, { prefix: '/api/corrective-actions' });
    await fastify.register(documentRoutes, { prefix: '/api/documents' });
    await fastify.register(alertRoutes, { prefix: '/api/alerts' });
    await fastify.register(scoringRoutes, { prefix: '/api/scoring' });
    await fastify.register(aiRoutes, { prefix: '/api/ai' });
    await fastify.register(reportRoutes, { prefix: '/api/reports' });

    // 4. Initialize Database and Auto-Seed
    await initDb();
    await seedDatabase();

    // 5. Initialize Automated Alerts Background Cron
    initAlertsCron();

    // 6. Listen
    const port = Number(process.env.PORT) || 5000;
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    console.log(`🚀 Hospital Compliance & Accreditation Backend running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

startServer();
