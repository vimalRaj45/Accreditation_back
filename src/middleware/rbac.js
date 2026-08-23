export function authorizeRoles(...allowedRoles) {
  return async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User not authenticated' });
    }

    const userRole = request.user.role;
    // Super Admin has universal override access
    if (userRole === 'Super Admin') {
      return;
    }

    if (!allowedRoles.includes(userRole)) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Access denied. Role '${userRole}' is not permitted to perform this action. Required: [${allowedRoles.join(', ')}]`
      });
    }
  };
}

export const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  HOSPITAL_ADMIN: 'Hospital Admin',
  DEPT_HEAD: 'Department Head',
  AUDITOR: 'Auditor',
  STAFF: 'Staff'
};

export default {
  authorizeRoles,
  ROLES
};
