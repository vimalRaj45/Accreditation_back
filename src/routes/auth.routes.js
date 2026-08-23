import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';

export default async function authRoutes(fastify, options) {
  // Login route
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Validation Error', message: 'Email and password are required' });
    }

    const userRes = await query(
      `SELECT u.id, u.hospital_id, u.department_id, u.name, u.email, u.password_hash, u.role, u.is_active, 
              h.name as hospital_name, h.code as hospital_code, h.accreditation_target, d.name as department_name
       FROM users u
       LEFT JOIN hospitals h ON u.hospital_id = h.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.email = $1`,
      [email.trim().toLowerCase()]
    );

    if (userRes.rows.length === 0) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Account is deactivated. Contact your hospital administrator.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid email or password' });
    }

    // Generate JWT Token
    const token = fastify.jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        hospital_id: user.hospital_id,
        department_id: user.department_id
      },
      { expiresIn: '7d' }
    );

    return {
      token,
      user: {
        id: user.id,
        hospital_id: user.hospital_id,
        department_id: user.department_id,
        name: user.name,
        email: user.email,
        role: user.role,
        hospitalName: user.hospital_name || 'Metro Apex Super Specialty Hospital',
        departmentName: user.department_name || 'All Departments'
      }
    };
  });

  // Current User Profile
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const userRes = await query(
      `SELECT u.id, u.hospital_id, u.department_id, u.name, u.email, u.role, u.phone, u.created_at,
              h.name as hospital_name, h.accreditation_target, d.name as department_name
       FROM users u
       LEFT JOIN hospitals h ON u.hospital_id = h.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = $1`,
      [request.user.id]
    );

    if (userRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Not Found', message: 'User profile not found' });
    }

    return { user: userRes.rows[0] };
  });

  // List Predefined Demo Credentials for 1-Click Login / Demo mode
  fastify.get('/demo-users', async () => {
    return {
      demoUsers: [
        { role: 'Hospital Admin', email: 'admin@medicare.org', password: 'Password123!', desc: 'Full hospital administration & compliance control' },
        { role: 'Super Admin', email: 'superadmin@medicare.org', password: 'Password123!', desc: 'Multi-hospital & system governance' },
        { role: 'Department Head', email: 'depthead@medicare.org', password: 'Password123!', desc: 'Emergency & Critical Care clinical head' },
        { role: 'Auditor', email: 'auditor@medicare.org', password: 'Password123!', desc: 'Mock audits & non-conformance findings recorder' },
        { role: 'Staff', email: 'staff@medicare.org', password: 'Password123!', desc: 'Nursing & operational checklist executor' }
      ]
    };
  });
}
