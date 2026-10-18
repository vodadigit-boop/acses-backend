const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { db } = require('./db');
const { generateClassListPDF } = require('./pdf-service');

function getProgramCode(program) {
  const p = (program || '').toUpperCase();
  if (p.includes('CYBER')) return 'CY';
  if (p.includes('COMPUTER') || p.includes('SCIENCE')) return 'CE';
  if (p.includes('ROBOT') || p.includes('AI')) return 'RB';
  if (p.includes('INFORMATION') || p.includes('SYSTEM')) return 'IS';
  return 'CE';
}

function getStudentPassword(arg1, arg2, arg3) {
  let whatsappNumber, program;
  if (arg3 !== undefined) {
    whatsappNumber = arg2;
    program = arg3;
  } else {
    whatsappNumber = arg1;
    program = arg2;
  }
  const cleanNumber = (whatsappNumber || '').replace(/\D/g, '');
  const last4 = cleanNumber.slice(-4) || '1234';
  const code = getProgramCode(program);
  return `${last4}${code}`;
}

// Safe transaction helper for node:sqlite DatabaseSync
function runTransaction(fn) {
  try {
    db.exec('BEGIN TRANSACTION;');
  } catch (e) {
    if (e.message && e.message.includes('within a transaction')) {
      try { db.exec('ROLLBACK;'); } catch (_) {}
      db.exec('BEGIN TRANSACTION;');
    } else {
      throw e;
    }
  }
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (_) {}
    throw err;
  }
}

// ===========================================================================
// Constitutional Course Representative Winning & Assignment Algorithm
// Rule Specification:
// 1. Male winner with more votes (1st place Male) -> Class A Course Representative (Main)
// 2. Female winner with less votes (2nd place Female) -> Class A Assistant Course Representative
// 3. Female winner with more votes (1st place Female) -> Class B Course Representative (Main)
// 4. Male winner with less votes (2nd place Male) -> Class B Assistant Course Representative
// All other contestants (3rd place and below) -> Runner-up Aspirants
// ===========================================================================
function computeElectionWinners() {
  const programs = [
    'COMPUTER SCIENCE',
    'CYBERSECURITY',
    'ROBOTICS & AI',
    'INFORMATION SYSTEMS & TECHNOLOGY'
  ];

  const allCandidates = db.prepare(`
    SELECT
      c.id,
      c.reference_number,
      u.full_name,
      u.gender,
      u.class_section,
      c.program,
      c.position,
      c.photo_url,
      c.slogan,
      c.manifesto,
      COUNT(v.id) AS vote_count
    FROM candidates c
    JOIN users u ON c.reference_number = u.reference_number
    LEFT JOIN votes v ON c.id = v.candidate_id
    WHERE c.is_approved = 1
    GROUP BY c.id
    ORDER BY vote_count DESC, c.id ASC
  `).all();

  const programResults = {};

  for (const prog of programs) {
    const candidates = allCandidates.filter(c => {
      const p = (c.program || '').toUpperCase();
      if (prog.includes('CYBER') && p.includes('CYBER')) return true;
      if (prog.includes('COMPUTER') && (p.includes('COMPUTER') || p.includes('SCIENCE'))) return true;
      if (prog.includes('ROBOT') && (p.includes('ROBOT') || p.includes('AI'))) return true;
      if (prog.includes('INFORMATION') && (p.includes('INFORMATION') || p.includes('SYSTEM'))) return true;
      return p === prog.toUpperCase();
    });

    const males = candidates
      .filter(c => (c.gender === 'MALE' || (c.position && c.position.includes('Male'))))
      .sort((a, b) => b.vote_count - a.vote_count || a.id - b.id);

    const females = candidates
      .filter(c => (c.gender === 'FEMALE' || (c.position && c.position.includes('Female'))))
      .sort((a, b) => b.vote_count - a.vote_count || a.id - b.id);

    const totalProgramVotes = candidates.reduce((sum, c) => sum + c.vote_count, 0);

    // 1. Male winner with more votes (1st Male) -> Class A Course Rep (Main)
    const classAMainRep = males.length > 0 ? {
      ...males[0],
      winning_title: 'Class A Course Representative',
      winning_role: 'Main Course Representative',
      assigned_class: 'Class A',
      is_winner: true,
      winner_category: 'CLASS_A_MAIN',
      winner_badge: '🏆 Winner • Class A Course Rep',
      gender_group: 'MALE',
      rank: 1
    } : null;

    // 2. Female winner with less votes (2nd Female) -> Class A Assistant Course Rep
    const classAAssistantRep = females.length > 1 ? {
      ...females[1],
      winning_title: 'Class A Assistant Course Representative',
      winning_role: 'Assistant Course Representative',
      assigned_class: 'Class A',
      is_winner: true,
      winner_category: 'CLASS_A_ASSISTANT',
      winner_badge: '🎖️ Winner • Class A Assistant Rep',
      gender_group: 'FEMALE',
      rank: 2
    } : null;

    // 3. Female winner with more votes (1st Female) -> Class B Course Rep (Main)
    const classBMainRep = females.length > 0 ? {
      ...females[0],
      winning_title: 'Class B Course Representative',
      winning_role: 'Main Course Representative',
      assigned_class: 'Class B',
      is_winner: true,
      winner_category: 'CLASS_B_MAIN',
      winner_badge: '🏆 Winner • Class B Course Rep',
      gender_group: 'FEMALE',
      rank: 1
    } : null;

    // 4. Male winner with less votes (2nd Male) -> Class B Assistant Course Rep
    const classBAssistantRep = males.length > 1 ? {
      ...males[1],
      winning_title: 'Class B Assistant Course Representative',
      winning_role: 'Assistant Course Representative',
      assigned_class: 'Class B',
      is_winner: true,
      winner_category: 'CLASS_B_ASSISTANT',
      winner_badge: '🎖️ Winner • Class B Assistant Rep',
      gender_group: 'MALE',
      rank: 2
    } : null;

    const winnerIdMap = new Map();
    if (classAMainRep) winnerIdMap.set(classAMainRep.id, classAMainRep);
    if (classAAssistantRep) winnerIdMap.set(classAAssistantRep.id, classAAssistantRep);
    if (classBMainRep) winnerIdMap.set(classBMainRep.id, classBMainRep);
    if (classBAssistantRep) winnerIdMap.set(classBAssistantRep.id, classBAssistantRep);

    const annotatedMales = males.map((m, idx) => {
      if (winnerIdMap.has(m.id)) {
        return winnerIdMap.get(m.id);
      }
      return {
        ...m,
        winning_title: 'Aspirant (Runner-up)',
        winning_role: 'Runner-up',
        assigned_class: m.class_section,
        is_winner: false,
        winner_category: 'RUNNER_UP',
        winner_badge: 'Aspirant',
        gender_group: 'MALE',
        rank: idx + 1
      };
    });

    const annotatedFemales = females.map((f, idx) => {
      if (winnerIdMap.has(f.id)) {
        return winnerIdMap.get(f.id);
      }
      return {
        ...f,
        winning_title: 'Aspirant (Runner-up)',
        winning_role: 'Runner-up',
        assigned_class: f.class_section,
        is_winner: false,
        winner_category: 'RUNNER_UP',
        winner_badge: 'Aspirant',
        gender_group: 'FEMALE',
        rank: idx + 1
      };
    });

    programResults[prog] = {
      program: prog,
      total_votes: totalProgramVotes,
      total_candidates: candidates.length,
      winners: {
        class_a: {
          main_rep: classAMainRep,
          assistant_rep: classAAssistantRep
        },
        class_b: {
          main_rep: classBMainRep,
          assistant_rep: classBAssistantRep
        }
      },
      males: annotatedMales,
      females: annotatedFemales,
      all_aspirants: [...annotatedMales, ...annotatedFemales].sort((a, b) => b.vote_count - a.vote_count || a.id - b.id)
    };
  }

  return programResults;
}

function syncElectedClassCohorts() {
  const programResults = computeElectionWinners();
  runTransaction(() => {
    for (const [prog, data] of Object.entries(programResults)) {
      const caMain = data.winners.class_a.main_rep;
      const caAsst = data.winners.class_a.assistant_rep;
      const cbMain = data.winners.class_b.main_rep;
      const cbAsst = data.winners.class_b.assistant_rep;

      if (caMain) db.prepare("UPDATE users SET class_section = 'Class A' WHERE reference_number = ?").run(caMain.reference_number);
      if (caAsst) db.prepare("UPDATE users SET class_section = 'Class A' WHERE reference_number = ?").run(caAsst.reference_number);
      if (cbMain) db.prepare("UPDATE users SET class_section = 'Class B' WHERE reference_number = ?").run(cbMain.reference_number);
      if (cbAsst) db.prepare("UPDATE users SET class_section = 'Class B' WHERE reference_number = ?").run(cbAsst.reference_number);
    }
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'acses-election-secure-token-2026';

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check Endpoint for Render / Cloud monitoring
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), platform: 'ACSES Production Backend' });
});

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for candidate photo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'candidate-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required. Please sign in.' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired or invalid. Please sign in again.' });
    }
    req.user = decoded;
    next();
  });
}

// Admin Authorization Middleware
function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized. Admin access required.' });
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// 1. Authentication Routes
// ---------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { reference_number, pin } = req.body;

  if (!reference_number || !pin) {
    return res.status(400).json({ error: 'Reference number and 4-digit PIN are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE reference_number = ? COLLATE NOCASE').get(reference_number.trim());
  if (!user) {
    return res.status(401).json({ error: 'Invalid reference number. Check your student ID.' });
  }

  let validPin = bcrypt.compareSync(pin.trim(), user.password_hash);
  if (!validPin && user.role !== 'admin') {
    const formulaPassword = getStudentPassword(user.full_name, user.whatsapp_number, user.program);
    if (formulaPassword && pin.trim().toLowerCase() === formulaPassword.toLowerCase()) {
      validPin = true;
    }
  }

  if (!validPin) {
    return res.status(401).json({ error: 'Incorrect credentials. Enter your Student Reference Number and Password (e.g. 0270CE).' });
  }

  const payload = {
    reference_number: user.reference_number,
    full_name: user.full_name,
    gender: user.gender,
    program: user.program,
    class_section: user.class_section,
    role: user.role,
    has_voted: Boolean(user.has_voted),
    is_candidate: Boolean(user.is_candidate)
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

  res.json({
    token,
    user: payload
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT reference_number, full_name, gender, program, class_section, role, has_voted, is_candidate FROM users WHERE reference_number = ?').get(req.user.reference_number);
  if (!user) {
    return res.status(404).json({ error: 'User record not found.' });
  }

  let candidate_info = null;
  if (user.is_candidate) {
    candidate_info = db.prepare('SELECT id, position, photo_url, slogan, manifesto, is_approved FROM candidates WHERE reference_number = ?').get(req.user.reference_number) || null;
  }

  res.json({
    user: {
      ...user,
      has_voted: Boolean(user.has_voted),
      is_candidate: Boolean(user.is_candidate),
      candidate_info
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Program WhatsApp Links (Conditional Rendering)
// ---------------------------------------------------------------------------
app.get('/api/program-links', authenticateToken, (req, res) => {
  const { program, class_section } = req.user;

  const links = db.prepare('SELECT * FROM program_links WHERE program = ?').get(program);
  if (!links) {
    return res.status(404).json({ error: 'No community links found for this program.' });
  }

  // Strictly filter: Always Main Group + Discussion. Only show Class A or Class B.
  const responseData = {
    program: links.program,
    main_group_link: links.main_group_link,
    discussion_link: links.discussion_link,
    class_section: class_section,
    cohort_link: class_section === 'Class A' ? links.class_a_link : links.class_b_link
  };

  res.json(responseData);
});

// ---------------------------------------------------------------------------
// 3. Ballot & Voting Routes (Dual-Gender Class Reps: 1 Male Rep + 1 Female Rep)
// ---------------------------------------------------------------------------
app.get('/api/ballot', authenticateToken, (req, res) => {
  const { program, class_section, reference_number } = req.user;

  // 1. Check election status
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  const election_status = setting ? setting.value : 'closed';

  // 2. Check live voter status
  const voter = db.prepare('SELECT has_voted FROM users WHERE reference_number = ?').get(reference_number);
  const has_voted = voter ? Boolean(voter.has_voted) : false;

  // STRICT PRIVACY: Until ballots are opened/published by the Public Relations Officer, students must not see candidates
  if (election_status !== 'active') {
    return res.json({
      election_status,
      has_voted,
      program,
      class_section,
      ballots_published: false,
      candidates: [],
      male_candidates: [],
      female_candidates: []
    });
  }

  // 3. Filter candidates strictly by user.program and is_approved = 1
  const candidates = db.prepare(`
    SELECT c.id, c.reference_number, u.full_name, u.gender, u.class_section, c.program, c.position, c.photo_url, c.slogan, c.manifesto
    FROM candidates c
    JOIN users u ON c.reference_number = u.reference_number
    WHERE c.program = ? AND c.is_approved = 1
    ORDER BY c.position ASC, c.id ASC
  `).all(program);

  const male_candidates = candidates.filter(c => c.gender === 'MALE' || c.position.includes('Male'));
  const female_candidates = candidates.filter(c => c.gender === 'FEMALE' || c.position.includes('Female'));

  res.json({
    election_status,
    has_voted,
    program,
    class_section,
    ballots_published: true,
    candidates,
    male_candidates,
    female_candidates
  });
});

app.post('/api/ballot/vote', authenticateToken, (req, res) => {
  const { reference_number, program, class_section } = req.user;
  let { male_candidate_id, female_candidate_id, candidate_ids, candidate_id } = req.body;

  const selectedIds = [];
  if (male_candidate_id) selectedIds.push(parseInt(male_candidate_id, 10));
  if (female_candidate_id) selectedIds.push(parseInt(female_candidate_id, 10));
  if (Array.isArray(candidate_ids)) {
    candidate_ids.forEach(id => {
      const parsed = parseInt(id, 10);
      if (parsed && !selectedIds.includes(parsed)) selectedIds.push(parsed);
    });
  }
  if (candidate_id) {
    const parsed = parseInt(candidate_id, 10);
    if (parsed && !selectedIds.includes(parsed)) selectedIds.push(parsed);
  }

  if (selectedIds.length === 0) {
    return res.status(400).json({ error: 'Please select at least one candidate before casting your ballot.' });
  }

  // Rule 1: Master election switch check
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  const election_status = setting ? setting.value : 'closed';
  if (election_status !== 'active') {
    return res.status(403).json({ error: 'Voting is currently unavailable. Election status: ' + election_status });
  }

  // Rule 2: Candidate program and class verification
  const verifiedCandidates = [];
  for (const cid of selectedIds) {
    const candidate = db.prepare(`
      SELECT c.id, c.program, c.position, c.is_approved, u.gender, u.class_section
      FROM candidates c
      JOIN users u ON c.reference_number = u.reference_number
      WHERE c.id = ?
    `).get(cid);

    if (!candidate || !candidate.is_approved) {
      return res.status(400).json({ error: 'One or more selected candidates are not approved.' });
    }

    if (candidate.program !== program) {
      return res.status(403).json({ error: 'Unauthorized ballot: candidate belongs to a different program.' });
    }

    verifiedCandidates.push(candidate);
  }

  // Ensure at most 1 male and at most 1 female candidate
  const maleCount = verifiedCandidates.filter(c => c.gender === 'MALE' || c.position.includes('Male')).length;
  const femaleCount = verifiedCandidates.filter(c => c.gender === 'FEMALE' || c.position.includes('Female')).length;
  if (maleCount > 1 || femaleCount > 1) {
    return res.status(400).json({ error: 'You may cast at most 1 vote for Male Representative and 1 vote for Female Representative.' });
  }

  // Rule 3: Atomic Transaction
  try {
    runTransaction(() => {
      const currentUser = db.prepare('SELECT has_voted FROM users WHERE reference_number = ?').get(reference_number);
      if (!currentUser) {
        throw new Error('STUDENT_NOT_FOUND');
      }
      if (currentUser.has_voted) {
        throw new Error('ALREADY_VOTED');
      }

      const updateResult = db.prepare('UPDATE users SET has_voted = 1 WHERE reference_number = ? AND has_voted = 0').run(reference_number);
      if (updateResult.changes === 0) {
        throw new Error('CONCURRENT_VOTE');
      }

      const insertVote = db.prepare('INSERT INTO votes (candidate_id, program) VALUES (?, ?)');
      for (const cand of verifiedCandidates) {
        insertVote.run(cand.id, program);
      }
    });

    return res.json({
      success: true,
      message: `Ballot cast successfully! Recorded anonymously for ${verifiedCandidates.length} Course Representative seat${verifiedCandidates.length > 1 ? 's' : ''}.`
    });
  } catch (error) {
    if (error.message === 'STUDENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Student record not found.' });
    }
    if (error.message === 'ALREADY_VOTED' || error.message === 'CONCURRENT_VOTE') {
      return res.status(400).json({ error: 'Ballot already cast. Each student may vote only once.' });
    }
    console.error('Vote processing transaction failed:', error);
    return res.status(500).json({ error: 'Failed to record ballot securely. Please retry.' });
  }
});

// ---------------------------------------------------------------------------
// 4. Candidate Application Workflow (Dual-Gender Class Reps)
// ---------------------------------------------------------------------------
app.post('/api/candidates/verify-student', (req, res) => {
  const { reference_number, pin } = req.body;
  if (!reference_number || !pin) {
    return res.status(400).json({ error: 'Please enter both your Student Reference Number and Voter Access Password (e.g. 0270CE).' });
  }

  const student = db.prepare('SELECT reference_number, full_name, gender, program, class_section, password_hash, role, is_candidate, whatsapp_number FROM users WHERE reference_number = ?').get(reference_number.trim());
  if (!student || student.role === 'admin') {
    return res.status(404).json({ error: 'Student record not found in ACSES roster. Please check your reference number.' });
  }

  let match = bcrypt.compareSync(pin.trim(), student.password_hash);
  if (!match) {
    const formulaPassword = getStudentPassword(student.full_name, student.whatsapp_number, student.program);
    if (formulaPassword && pin.trim().toLowerCase() === formulaPassword.toLowerCase()) {
      match = true;
    }
  }

  if (!match) {
    return res.status(401).json({ error: 'Invalid password. Enter your Student Password (e.g. 0270CE).' });
  }

  const existingCand = db.prepare('SELECT id, is_approved FROM candidates WHERE reference_number = ?').get(student.reference_number);

  const assignedPosition = student.gender === 'MALE'
    ? 'Male Course Representative'
    : 'Female Course Representative';

  res.json({
    valid: true,
    student: {
      reference_number: student.reference_number,
      full_name: student.full_name,
      program: student.program,
      class_section: student.class_section,
      gender: student.gender,
      position: assignedPosition,
      is_candidate: Boolean(student.is_candidate || existingCand),
      candidate_id: existingCand ? existingCand.id : null,
      is_approved: existingCand ? Boolean(existingCand.is_approved) : false
    }
  });
});

app.post('/api/candidates/apply', upload.single('photo'), (req, res) => {
  let user = null;

  // 1. Check Bearer Token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      user = db.prepare('SELECT reference_number, full_name, gender, program, class_section, role FROM users WHERE reference_number = ?').get(decoded.reference_number);
    } catch (_) {}
  }

  // 2. If no valid Bearer token, check direct reference_number and pin in body
  if (!user) {
    const { reference_number, pin } = req.body;
    if (!reference_number || !pin) {
      return res.status(401).json({ error: 'Please provide your Student Reference Number and Voter Access Password (e.g. 0270CE).' });
    }
    const student = db.prepare('SELECT reference_number, full_name, gender, program, class_section, password_hash, role, whatsapp_number FROM users WHERE reference_number = ?').get(reference_number.trim());
    if (!student || student.role === 'admin') {
      return res.status(401).json({ error: 'Student record not found in ACSES roster.' });
    }
    let match = bcrypt.compareSync(pin.trim(), student.password_hash);
    if (!match) {
      const formulaPassword = getStudentPassword(student.full_name, student.whatsapp_number, student.program);
      if (formulaPassword && pin.trim().toLowerCase() === formulaPassword.toLowerCase()) {
        match = true;
      }
    }
    if (!match) {
      return res.status(401).json({ error: 'Invalid password. Enter your Student Password (e.g. 0270CE).' });
    }
    user = student;
  }

  const { reference_number, program, gender, class_section } = user;
  const { manifesto, photo_url_input, slogan } = req.body;

  if (!manifesto || manifesto.trim().length < 20) {
    return res.status(400).json({ error: 'Please provide a meaningful manifesto (minimum 20 characters).' });
  }

  // Check if candidate already applied
  const existing = db.prepare('SELECT * FROM candidates WHERE reference_number = ?').get(reference_number);
  if (existing) {
    return res.status(400).json({ error: 'You have already submitted an application.' });
  }

  let finalPhotoUrl = '';
  if (req.file) {
    finalPhotoUrl = '/uploads/' + req.file.filename;
  } else if (photo_url_input && photo_url_input.trim()) {
    finalPhotoUrl = photo_url_input.trim();
  } else {
    finalPhotoUrl = '/person-avatar.svg';
  }

  // Automatic dual-gender class rep position assignment
  const assignedPosition = gender === 'MALE'
    ? 'Male Course Representative'
    : 'Female Course Representative';

  try {
    runTransaction(() => {
      db.prepare(`
        INSERT INTO candidates (reference_number, program, position, photo_url, slogan, manifesto, is_approved)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run(reference_number, program, assignedPosition, finalPhotoUrl, (slogan || '').trim(), manifesto.trim());

      db.prepare('UPDATE users SET is_candidate = 1 WHERE reference_number = ?').run(reference_number);
    });

    res.json({
      success: true,
      user: {
        reference_number: user.reference_number,
        full_name: user.full_name,
        program: user.program,
        class_section: user.class_section,
        position: assignedPosition
      },
      message: `Nomination for ${assignedPosition} (${class_section}) submitted successfully. It is currently pending Public Relations Officer review.`
    });
  } catch (err) {
    console.error('Candidate application failed:', err);
    res.status(500).json({ error: 'Application submission failed.' });
  }
});

// ---------------------------------------------------------------------------
// 5. Admin Dashboard Endpoints (Protected by role === 'admin')
// ---------------------------------------------------------------------------

// A. Turnout Analytics & Election Overview
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const statusRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  const election_status = statusRow ? statusRow.value : 'closed';

  const totalRegistered = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'voter'").get().count;
  const totalVotes = db.prepare('SELECT COUNT(*) AS count FROM votes').get().count;

  // Breakdown by program
  const programs = [
    'COMPUTER SCIENCE',
    'CYBERSECURITY',
    'ROBOTICS & AI',
    'INFORMATION SYSTEMS & TECHNOLOGY'
  ];

  const breakdown = programs.map(prog => {
    const reg = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND role = 'voter'").get(prog).count;
    const voted = db.prepare('SELECT COUNT(*) AS count FROM votes WHERE program = ?').get(prog).count;
    const turnoutPct = reg > 0 ? Math.round((voted / reg) * 100) : 0;

    return {
      program: prog,
      registered: reg,
      voted: voted,
      turnoutPct
    };
  });

  const overallTurnoutPct = totalRegistered > 0 ? Math.round((totalVotes / totalRegistered) * 100) : 0;

  res.json({
    election_status,
    totalRegistered,
    totalVotes,
    overallTurnoutPct,
    breakdown
  });
});

// B. Election Master Switch
app.post('/api/admin/election-switch', requireAdmin, (req, res) => {
  const { status } = req.body;
  const allowed = ['active', 'paused', 'closed', 'published'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Allowed values: active, paused, closed, published.' });
  }

  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(status, 'election_status');

  // When polls close or results are published, synchronize cohort assignments for winners
  if (status === 'closed' || status === 'published') {
    try {
      syncElectedClassCohorts();
    } catch (e) {
      console.error('Failed to sync elected class cohorts:', e);
    }
  }

  res.json({
    success: true,
    message: `Election state successfully set to: ${status}`,
    election_status: status
  });
});

// C. Candidate Management & Approvals
app.get('/api/admin/candidates', requireAdmin, (req, res) => {
  const candidates = db.prepare(`
    SELECT c.id, c.reference_number, u.full_name, u.gender, u.class_section, c.program, c.position, c.photo_url, c.slogan, c.manifesto, c.is_approved
    FROM candidates c
    JOIN users u ON c.reference_number = u.reference_number
    ORDER BY c.is_approved ASC, c.program ASC, u.class_section ASC, c.id DESC
  `).all();

  res.json({ candidates });
});

app.post('/api/admin/candidates/:id/approve', requireAdmin, (req, res) => {
  const { id } = req.params;
  const result = db.prepare('UPDATE candidates SET is_approved = 1 WHERE id = ?').run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Candidate not found.' });
  }

  res.json({ success: true, message: 'Candidate approved. They are now visible on active ballots.' });
});

app.post('/api/admin/candidates/:id/reject', requireAdmin, (req, res) => {
  const { id } = req.params;
  const cand = db.prepare('SELECT reference_number FROM candidates WHERE id = ?').get(id);

  if (!cand) {
    return res.status(404).json({ error: 'Candidate not found.' });
  }

  runTransaction(() => {
    db.prepare('DELETE FROM candidates WHERE id = ?').run(id);
    db.prepare('UPDATE users SET is_candidate = 0 WHERE reference_number = ?').run(cand.reference_number);
  });

  res.json({ success: true, message: 'Candidate application rejected.' });
});

// D. Roster Management & PIN Resets
app.get('/api/admin/roster', requireAdmin, (req, res) => {
  const { program, class_section, search } = req.query;

  let query = "SELECT reference_number, full_name, gender, program, class_section, has_voted, is_candidate, role FROM users WHERE role = 'voter'";
  const params = [];

  if (program && program !== 'ALL') {
    query += ' AND program = ?';
    params.push(program);
  }

  if (class_section && class_section !== 'ALL') {
    query += ' AND class_section = ?';
    params.push(class_section);
  }

  if (search && search.trim()) {
    query += ' AND (full_name LIKE ? OR reference_number LIKE ?)';
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  query += ' ORDER BY program ASC, class_section ASC, full_name ASC';

  const students = db.prepare(query).all(...params);
  res.json({ students });
});

app.post('/api/admin/reset-pin', requireAdmin, (req, res) => {
  const { reference_number } = req.body;
  if (!reference_number) {
    return res.status(400).json({ error: 'Reference number required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE reference_number = ?').get(reference_number);
  if (!user) {
    return res.status(404).json({ error: 'Student not found in roster.' });
  }

  // Restore formula password (Firstname + Last 4 WhatsApp + Program code)
  const defaultPassword = getStudentPassword(user.full_name, user.whatsapp_number, user.program);
  const newHash = bcrypt.hashSync(defaultPassword, 10);

  db.prepare('UPDATE users SET password_hash = ? WHERE reference_number = ?').run(newHash, reference_number);

  res.json({
    success: true,
    message: `Password reset successfully for ${user.full_name}.`,
    reference_number,
    newPin: defaultPassword
  });
});

// E. Results & Audit Log Export
app.get('/api/admin/results', requireAdmin, (req, res) => {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  const election_status = setting ? setting.value : 'closed';
  const results = computeElectionWinners();

  res.json({
    election_status,
    results,
    results_published: true
  });
});

// Voter & Student Certified Election Results
app.get('/api/results', authenticateToken, (req, res) => {
  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  const election_status = setting ? setting.value : 'closed';
  const isClosedOrAdmin = election_status === 'closed' || election_status === 'published' || req.user.role === 'admin';

  const results = computeElectionWinners();

  res.json({
    election_status,
    results_published: isClosedOrAdmin,
    user_program: req.user.program,
    user_class: req.user.class_section,
    results
  });
});

// Admin endpoint to trigger/inspect rebalancing / cohort sync
app.post('/api/admin/rebalance-reps', requireAdmin, (req, res) => {
  syncElectedClassCohorts();
  const results = computeElectionWinners();
  res.json({
    success: true,
    message: 'Cohort representatives synchronized with elected winners.',
    results
  });
});

// Voter Live Program Election Tracker
app.get('/api/voter/program-tracker', authenticateToken, (req, res) => {
  const { program } = req.user;

  const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('election_status');
  const election_status = setting ? setting.value : 'closed';

  const totalRegistered = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND role = 'voter'").get(program).count;
  const totalVoted = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND role = 'voter' AND has_voted = 1").get(program).count;
  const turnoutPct = totalRegistered > 0 ? ((totalVoted / totalRegistered) * 100).toFixed(1) : '0.0';

  const classAReg = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND class_section = 'Class A' AND role = 'voter'").get(program).count;
  const classAVoted = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND class_section = 'Class A' AND role = 'voter' AND has_voted = 1").get(program).count;
  const classAPct = classAReg > 0 ? ((classAVoted / classAReg) * 100).toFixed(1) : '0.0';

  const classBReg = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND class_section = 'Class B' AND role = 'voter'").get(program).count;
  const classBVoted = db.prepare("SELECT COUNT(*) AS count FROM users WHERE program = ? AND class_section = 'Class B' AND role = 'voter' AND has_voted = 1").get(program).count;
  const classBPct = classBReg > 0 ? ((classBVoted / classBReg) * 100).toFixed(1) : '0.0';

  const allWinners = computeElectionWinners();
  const progResult = allWinners[program] || null;

  const candidates = db.prepare(`
    SELECT
      c.id,
      u.reference_number,
      u.full_name,
      u.gender,
      u.class_section,
      c.position,
      c.photo_url,
      c.slogan,
      COUNT(v.id) AS vote_count
    FROM candidates c
    JOIN users u ON c.reference_number = u.reference_number
    LEFT JOIN votes v ON c.id = v.candidate_id
    WHERE c.program = ? AND c.is_approved = 1
    GROUP BY c.id
    ORDER BY vote_count DESC, c.id ASC
  `).all(program);

  res.json({
    program,
    election_status,
    total_registered: totalRegistered,
    total_voted: totalVoted,
    turnout_pct: turnoutPct,
    cohorts: {
      class_a: { registered: classAReg, voted: classAVoted, pct: classAPct },
      class_b: { registered: classBReg, voted: classBVoted, pct: classBPct }
    },
    candidates: progResult ? progResult.all_aspirants : candidates,
    winners: progResult ? progResult.winners : null
  });
});

app.get('/api/admin/export-audit', requireAdmin, (req, res) => {
  const votes = db.prepare(`
    SELECT
      v.id AS ballot_id,
      v.program,
      v.created_at,
      u.full_name AS candidate_voted_for,
      c.position
    FROM votes v
    JOIN candidates c ON v.candidate_id = c.id
    JOIN users u ON c.reference_number = u.reference_number
    ORDER BY v.id ASC
  `).all();

  let csv = 'Ballot ID,Program,Candidate Voted For,Position,Timestamp (UTC),Voter Identity Status\n';
  for (const row of votes) {
    csv += `"${row.ballot_id}","${row.program}","${row.candidate_voted_for.replace(/"/g, '""')}","${row.position}","${row.created_at}","ANONYMOUS"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="acses-election-audit-log.csv"');
  res.send(csv);
});

// PDF Class List Export for Admin
app.get('/api/admin/export-class-list-pdf', (req, res) => {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication token required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin authorization required.' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  const { program, class_section } = req.query;
  if (!program || !class_section) {
    return res.status(400).json({ error: 'Both program and class_section are required.' });
  }

  const students = db.prepare(`
    SELECT reference_number, full_name, gender, program, class_section, has_voted, is_candidate, whatsapp_number
    FROM users
    WHERE program = ? AND class_section = ?
    ORDER BY full_name ASC
  `).all(program, class_section);

  if (students.length === 0) {
    return res.status(404).json({ error: `No students found for ${program} (${class_section}).` });
  }

  const filename = `${program.toUpperCase()} - ${class_section.toUpperCase()}.pdf`;
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '');
  const encodedFilename = encodeURIComponent(filename);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);

  generateClassListPDF(program, class_section, students, res);
});

// F. WhatsApp Links Management for Admin
app.get('/api/admin/program-links', requireAdmin, (req, res) => {
  const links = db.prepare('SELECT * FROM program_links ORDER BY program ASC').all();
  res.json({ links });
});

app.post('/api/admin/program-links', requireAdmin, (req, res) => {
  const { program, main_group_link, discussion_link, class_a_link, class_b_link } = req.body;

  if (!program || !main_group_link || !discussion_link || !class_a_link || !class_b_link) {
    return res.status(400).json({ error: 'All fields (Program, Main Group, Discussion, Class A, Class B) are required.' });
  }

  const stmt = db.prepare(`
    INSERT INTO program_links (program, main_group_link, discussion_link, class_a_link, class_b_link)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(program) DO UPDATE SET
      main_group_link = excluded.main_group_link,
      discussion_link = excluded.discussion_link,
      class_a_link = excluded.class_a_link,
      class_b_link = excluded.class_b_link
  `);

  stmt.run(program.trim(), main_group_link.trim(), discussion_link.trim(), class_a_link.trim(), class_b_link.trim());

  res.json({
    success: true,
    message: `WhatsApp links updated successfully for ${program}.`
  });
});


// Fallback for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 ACSES Election Server running on http://localhost:${PORT}`);
});
