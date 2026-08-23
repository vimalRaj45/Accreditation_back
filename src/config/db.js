import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pool = null;
let isMockDb = false;

// Comprehensive In-Memory PostgreSQL Mock Engine
class MockPostgresStore {
  constructor() {
    this.tables = {
      hospitals: [],
      departments: [],
      users: [],
      requirements: [],
      kpis: [],
      audits: [],
      audit_findings: [],
      corrective_actions: [],
      documents: [],
      notifications: [],
      scoring_weights: []
    };
    this.sequences = {};
    for (const tbl of Object.keys(this.tables)) {
      this.sequences[tbl] = 1;
    }
  }

  nextId(table) {
    if (!this.sequences[table]) this.sequences[table] = 1;
    return this.sequences[table]++;
  }

  async query(sqlText, params = []) {
    const rawSql = sqlText.trim();
    const upper = rawSql.toUpperCase();

    // Health / Simple test
    if (upper.startsWith('SELECT 1') || upper.startsWith('SELECT NOW()')) {
      return { rows: [{ '?column?': 1, now: new Date().toISOString() }], rowCount: 1 };
    }

    if (upper.startsWith('SELECT')) {
      return this.handleSelect(rawSql, params);
    } else if (upper.startsWith('INSERT INTO')) {
      return this.handleInsert(rawSql, params);
    } else if (upper.startsWith('UPDATE')) {
      return this.handleUpdate(rawSql, params);
    } else if (upper.startsWith('DELETE FROM')) {
      return this.handleDelete(rawSql, params);
    }

    return { rows: [], rowCount: 0 };
  }

  handleSelect(sql, params) {
    // Known system tables in priority order
    const knownTables = [
      'audit_findings',
      'corrective_actions',
      'scoring_weights',
      'requirements',
      'notifications',
      'departments',
      'documents',
      'hospitals',
      'audits',
      'users',
      'kpis'
    ];

    let table = null;
    // Find the main primary table in query
    for (const t of knownTables) {
      const regex = new RegExp(`\\bFROM\\s+${t}\\b`, 'i');
      if (regex.test(sql)) {
        table = t;
        break;
      }
    }

    if (!table) {
      const fromMatch = sql.match(/FROM\s+([a-zA-Z_]+)/i);
      table = fromMatch ? fromMatch[1].toLowerCase() : 'requirements';
    }

    let rows = (this.tables[table] || []).map(r => ({ ...r }));

    // Populate relational virtual fields for common UI queries
    if (table === 'users') {
      rows = rows.map(u => {
        const dept = (this.tables.departments || []).find(d => Number(d.id) === Number(u.department_id));
        const hosp = (this.tables.hospitals || []).find(h => Number(h.id) === Number(u.hospital_id));
        return {
          ...u,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          hospital_name: hosp ? hosp.name : 'Metro Apex Super Specialty Hospital'
        };
      });
    } else if (table === 'departments') {
      rows = rows.map(d => {
        const uCount = (this.tables.users || []).filter(u => Number(u.department_id) === Number(d.id)).length;
        const rCount = (this.tables.requirements || []).filter(r => Number(r.department_id) === Number(d.id)).length;
        const kCount = (this.tables.kpis || []).filter(k => Number(k.department_id) === Number(d.id)).length;
        return {
          ...d,
          user_count: uCount,
          req_count: rCount,
          kpi_count: kCount
        };
      });
    } else if (table === 'requirements') {
      rows = rows.map(r => {
        const dept = (this.tables.departments || []).find(d => Number(d.id) === Number(r.department_id));
        const user = (this.tables.users || []).find(u => Number(u.id) === Number(r.assigned_to));
        const docCount = (this.tables.documents || []).filter(doc => Number(doc.linked_requirement_id) === Number(r.id)).length;
        return {
          ...r,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          assignee_name: user ? user.name : null,
          evidence_count: docCount
        };
      });
    } else if (table === 'kpis') {
      rows = rows.map(k => {
        const dept = (this.tables.departments || []).find(d => Number(d.id) === Number(k.department_id));
        const user = (this.tables.users || []).find(u => Number(u.id) === Number(k.updated_by));
        return {
          ...k,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          updated_by_name: user ? user.name : null
        };
      });
    } else if (table === 'audits') {
      rows = rows.map(a => {
        const dept = (this.tables.departments || []).find(d => Number(d.id) === Number(a.department_id));
        const auditor = (this.tables.users || []).find(u => Number(u.id) === Number(a.lead_auditor_id));
        const fList = (this.tables.audit_findings || []).filter(f => Number(f.audit_id) === Number(a.id));
        return {
          ...a,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          lead_auditor_name: auditor ? auditor.name : null,
          findings_count: fList.length,
          critical_count: fList.filter(f => f.severity === 'Critical').length
        };
      });
    } else if (table === 'audit_findings') {
      rows = rows.map(f => {
        const req = (this.tables.requirements || []).find(r => Number(r.id) === Number(f.requirement_id));
        const capa = (this.tables.corrective_actions || []).find(c => Number(c.finding_id) === Number(f.id));
        return {
          ...f,
          requirement_code: req ? req.code : null,
          requirement_title: req ? req.title : null,
          capa_id: capa ? capa.id : null,
          capa_status: capa ? capa.status : null
        };
      });
    } else if (table === 'corrective_actions') {
      rows = rows.map(c => {
        const dept = (this.tables.departments || []).find(d => Number(d.id) === Number(c.department_id));
        const assignee = (this.tables.users || []).find(u => Number(u.id) === Number(c.assigned_to));
        const verifier = (this.tables.users || []).find(u => Number(u.id) === Number(c.verified_by));
        const finding = (this.tables.audit_findings || []).find(f => Number(f.id) === Number(c.finding_id));
        const req = (this.tables.requirements || []).find(r => Number(r.id) === Number(c.requirement_id));
        const docCount = (this.tables.documents || []).filter(d => Number(d.linked_corrective_action_id) === Number(c.id)).length;
        return {
          ...c,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          assignee_name: assignee ? assignee.name : null,
          verifier_name: verifier ? verifier.name : null,
          finding_title: finding ? finding.title : null,
          finding_severity: finding ? finding.severity : null,
          requirement_code: req ? req.code : null,
          requirement_title: req ? req.title : null,
          evidence_count: docCount
        };
      });
    } else if (table === 'documents') {
      rows = rows.map(doc => {
        const dept = (this.tables.departments || []).find(d => Number(d.id) === Number(doc.department_id));
        const user = (this.tables.users || []).find(u => Number(u.id) === Number(doc.uploaded_by));
        const req = (this.tables.requirements || []).find(r => Number(r.id) === Number(doc.linked_requirement_id));
        const audit = (this.tables.audits || []).find(a => Number(a.id) === Number(doc.linked_audit_id));
        const capa = (this.tables.corrective_actions || []).find(c => Number(c.id) === Number(doc.linked_corrective_action_id));
        return {
          ...doc,
          department_name: dept ? dept.name : null,
          department_code: dept ? dept.code : null,
          uploader_name: user ? user.name : null,
          requirement_code: req ? req.code : null,
          requirement_title: req ? req.title : null,
          audit_title: audit ? audit.title : null,
          capa_title: capa ? capa.title : null
        };
      });
    }

    // Apply WHERE Filters
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER BY|LIMIT|$)/is);
    if (whereMatch) {
      const whereClause = whereMatch[1];

      // Email match
      const emailMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?email\s*=\s*\$(\d+)/i);
      if (emailMatch) {
        const pIdx = parseInt(emailMatch[1], 10) - 1;
        const targetEmail = String(params[pIdx] || '').toLowerCase();
        rows = rows.filter(r => r.email && r.email.toLowerCase() === targetEmail);
      }
      // ID match
      const idMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?id\s*=\s*\$(\d+)/i);
      if (idMatch) {
        const pIdx = parseInt(idMatch[1], 10) - 1;
        const targetId = parseInt(params[pIdx], 10);
        rows = rows.filter(r => Number(r.id) === targetId);
      }
      // Hospital match
      const hospMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?hospital_id\s*=\s*\$(\d+)/i);
      if (hospMatch) {
        const pIdx = parseInt(hospMatch[1], 10) - 1;
        const hId = parseInt(params[pIdx], 10);
        rows = rows.filter(r => Number(r.hospital_id) === hId);
      }
      // Department match
      const deptMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?department_id\s*=\s*\$(\d+)/i);
      if (deptMatch) {
        const pIdx = parseInt(deptMatch[1], 10) - 1;
        const dId = parseInt(params[pIdx], 10);
        rows = rows.filter(r => Number(r.department_id) === dId);
      }
      // Audit ID match
      const auditMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?audit_id\s*=\s*\$(\d+)/i);
      if (auditMatch) {
        const pIdx = parseInt(auditMatch[1], 10) - 1;
        const aId = parseInt(params[pIdx], 10);
        rows = rows.filter(r => Number(r.audit_id) === aId);
      }
      // User ID match
      const userMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?user_id\s*=\s*\$(\d+)/i);
      if (userMatch) {
        const pIdx = parseInt(userMatch[1], 10) - 1;
        const uId = parseInt(params[pIdx], 10);
        rows = rows.filter(r => Number(r.user_id) === uId);
      }
      // Code match
      const codeMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?code\s*=\s*\$(\d+)/i);
      if (codeMatch) {
        const pIdx = parseInt(codeMatch[1], 10) - 1;
        const cVal = String(params[pIdx] || '').toLowerCase();
        rows = rows.filter(r => r.code && r.code.toLowerCase() === cVal);
      }
      // Title match
      const titleMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?title\s*=\s*\$(\d+)/i);
      if (titleMatch) {
        const pIdx = parseInt(titleMatch[1], 10) - 1;
        const tVal = String(params[pIdx] || '').toLowerCase();
        rows = rows.filter(r => r.title && r.title.toLowerCase() === tVal);
      }
      // Filename match
      const fnMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?filename\s*=\s*\$(\d+)/i);
      if (fnMatch) {
        const pIdx = parseInt(fnMatch[1], 10) - 1;
        const fnVal = String(params[pIdx] || '').toLowerCase();
        rows = rows.filter(r => r.filename && r.filename.toLowerCase() === fnVal);
      }
      // Standard match
      const stdMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?standard\s*=\s*\$(\d+)/i);
      if (stdMatch) {
        const pIdx = parseInt(stdMatch[1], 10) - 1;
        const sVal = params[pIdx];
        rows = rows.filter(r => r.standard === sVal);
      }
      // Priority match
      const prioMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?priority\s*=\s*\$(\d+)/i);
      if (prioMatch) {
        const pIdx = parseInt(prioMatch[1], 10) - 1;
        const prVal = params[pIdx];
        rows = rows.filter(r => r.priority === prVal);
      }
      // Category match
      const catMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?category\s*=\s*\$(\d+)/i);
      if (catMatch) {
        const pIdx = parseInt(catMatch[1], 10) - 1;
        const cVal = params[pIdx];
        rows = rows.filter(r => r.category === cVal);
      }
      // Doc type match
      const dtMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?doc_type\s*=\s*\$(\d+)/i);
      if (dtMatch) {
        const pIdx = parseInt(dtMatch[1], 10) - 1;
        const dtVal = params[pIdx];
        rows = rows.filter(r => r.doc_type === dtVal);
      }
      // Status match
      const statusMatch = whereClause.match(/(?:[a-zA-Z_]+\.)?status\s*=\s*\$(\d+)/i);
      if (statusMatch) {
        const pIdx = parseInt(statusMatch[1], 10) - 1;
        const sVal = params[pIdx];
        rows = rows.filter(r => r.status === sVal);
      }
      // Unread only match
      if (/(?:[a-zA-Z_]+\.)?is_read\s*=\s*FALSE/i.test(whereClause)) {
        rows = rows.filter(r => r.is_read === false || r.is_read === 0);
      }
      // ILIKE search match
      const ilikeMatch = whereClause.match(/ILIKE\s*\$(\d+)/i);
      if (ilikeMatch) {
        const pIdx = parseInt(ilikeMatch[1], 10) - 1;
        const q = String(params[pIdx] || '').replace(/%/g, '').toLowerCase();
        if (q) {
          rows = rows.filter(r => 
            (r.title && r.title.toLowerCase().includes(q)) ||
            (r.code && r.code.toLowerCase().includes(q)) ||
            (r.name && r.name.toLowerCase().includes(q)) ||
            (r.chapter && r.chapter.toLowerCase().includes(q))
          );
        }
      }
    }

    // Handle Top-Level SELECT COUNT(*)
    if (/^\s*SELECT\s+COUNT\(\*\)\s+FROM/i.test(sql)) {
      return { rows: [{ count: rows.length }], rowCount: 1 };
    }

    // Handle Limit
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      const limit = parseInt(limitMatch[1], 10);
      rows = rows.slice(0, limit);
    }

    return { rows, rowCount: rows.length };
  }

  handleInsert(sql, params) {
    const tableMatch = sql.match(/INSERT\s+INTO\s+([a-zA-Z_]+)\s*\(([^)]+)\)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };

    const table = tableMatch[1].toLowerCase();
    const columns = tableMatch[2].split(',').map(c => c.trim().toLowerCase());

    if (!this.tables[table]) {
      this.tables[table] = [];
    }

    const newRecord = { id: this.nextId(table), created_at: new Date().toISOString() };
    columns.forEach((col, idx) => {
      newRecord[col] = params[idx] !== undefined ? params[idx] : null;
    });

    this.tables[table].push(newRecord);
    return { rows: [newRecord], rowCount: 1 };
  }

  handleUpdate(sql, params) {
    const tableMatch = sql.match(/UPDATE\s+([a-zA-Z_]+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/is);
    if (!tableMatch) return { rows: [], rowCount: 0 };

    const table = tableMatch[1].toLowerCase();
    const setClause = tableMatch[2];
    const whereClause = tableMatch[3];

    const records = this.tables[table] || [];
    let updatedRows = [];

    // Find target record by ID
    const idParamMatch = whereClause.match(/id\s*=\s*\$(\d+)/i);
    if (idParamMatch) {
      const paramIdx = parseInt(idParamMatch[1], 10) - 1;
      const targetId = parseInt(params[paramIdx], 10);
      const record = records.find(r => Number(r.id) === targetId);

      if (record) {
        const assignments = setClause.split(',');
        assignments.forEach(assign => {
          const m = assign.trim().match(/([a-zA-Z_]+)\s*=\s*(?:COALESCE\(\$(\d+)|(?:\$(\d+)))/i);
          if (m) {
            const col = m[1].toLowerCase();
            const pIdx = parseInt(m[2] || m[3], 10) - 1;
            if (params[pIdx] !== undefined && params[pIdx] !== null) {
              record[col] = params[pIdx];
            }
          }
        });
        record.updated_at = new Date().toISOString();
        updatedRows.push(record);
      }
    } else if (/is_read\s*=\s*TRUE/i.test(setClause)) {
      // Mark read
      records.forEach(r => { r.is_read = true; });
    }

    return { rows: updatedRows, rowCount: updatedRows.length };
  }

  handleDelete(sql, params) {
    const tableMatch = sql.match(/DELETE\s+FROM\s+([a-zA-Z_]+)\s+WHERE\s+id\s*=\s*\$(\d+)/i);
    if (!tableMatch) return { rows: [], rowCount: 0 };

    const table = tableMatch[1].toLowerCase();
    const paramIdx = parseInt(tableMatch[2], 10) - 1;
    const targetId = parseInt(params[paramIdx], 10);

    const initialLen = (this.tables[table] || []).length;
    this.tables[table] = (this.tables[table] || []).filter(r => Number(r.id) !== targetId);

    return { rows: [], rowCount: initialLen - this.tables[table].length };
  }
}

const mockStore = new MockPostgresStore();

export async function initDb() {
  if (pool) return pool;
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && !databaseUrl.includes('test@localhost') && !databaseUrl.includes('sample_pass')) {
    try {
      console.log('Connecting to PostgreSQL / Neon database...');
      const sslConfig = databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false };
      pool = new Pool({
        connectionString: databaseUrl,
        ssl: sslConfig,
        max: 10,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        keepAlive: true
      });

      // Handle idle serverless socket disconnects gracefully so Node.js process does not crash
      pool.on('error', (err) => {
        console.warn('[Neon Connection Pool] Idle client socket reset (auto-recovered):', err.message);
      });

      const client = await pool.connect();
      console.log('Successfully connected to Neon / PostgreSQL!');
      
      try {
        const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
        if (fs.existsSync(schemaPath)) {
          const schemaSql = fs.readFileSync(schemaPath, 'utf8');
          await client.query(schemaSql);
          console.log('Database schema verified/created successfully.');
        }
      } catch (schemaErr) {
        console.warn('Schema auto-migration warning:', schemaErr.message);
      } finally {
        client.release();
      }

      isMockDb = false;
      return pool;
    } catch (err) {
      console.warn('Could not connect to Neon PostgreSQL:', err.message);
      console.log('Falling back to High-Performance in-memory PostgreSQL engine.');
      isMockDb = true;
      return mockStore;
    }
  } else {
    isMockDb = true;
    return mockStore;
  }
}

export async function query(text, params = [], retries = 1) {
  if (!pool && !isMockDb) {
    await initDb();
  }

  if (isMockDb || !pool) {
    return mockStore.query(text, params);
  }

  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    if (retries > 0 && (err.code === 'ECONNRESET' || err.code === '57P01' || err.message.includes('Connection terminated'))) {
      console.warn('[Neon Query] Transient connection reset encountered, retrying query...');
      return query(text, params, retries - 1);
    }
    console.error('Database query error:', err.message, '\nQuery:', text);
    throw err;
  }
}

export function getMockStore() {
  return mockStore;
}

export function isUsingMock() {
  return isMockDb;
}

export default {
  initDb,
  query,
  getMockStore,
  isUsingMock
};
