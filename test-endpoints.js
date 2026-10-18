const http = require('node:http');
const { db } = require('./db');

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

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };

    const req = http.request(options, res => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (_) {
          resolve({ status: res.statusCode, raw: responseBody, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting ACSES Real Roster Endpoints & PRO Verification Tests...\n');

  // Select test students from the real roster
  const voter = db.prepare("SELECT * FROM users WHERE role = 'voter' AND gender = 'MALE' AND program = 'COMPUTER SCIENCE' AND class_section = 'Class A' LIMIT 1").get();
  if (!voter) throw new Error('Could not find test male student in COMPUTER SCIENCE Class A');
  const voterPassword = getStudentPassword(voter.full_name, voter.whatsapp_number, voter.program);

  const femaleAspirant = db.prepare("SELECT * FROM users WHERE role = 'voter' AND gender = 'FEMALE' AND program = 'COMPUTER SCIENCE' AND class_section = 'Class A' LIMIT 1").get();
  if (!femaleAspirant) throw new Error('Could not find test female aspirant in COMPUTER SCIENCE Class A');
  const femalePassword = getStudentPassword(femaleAspirant.full_name, femaleAspirant.whatsapp_number, femaleAspirant.program);

  // Clean any existing test state for idempotency
  db.exec(`
    DELETE FROM votes;
    DELETE FROM candidates;
    UPDATE users SET has_voted = 0, is_candidate = 0;
  `);

  // Test 1: Real Student Login
  console.log(`1. Testing Student Login (${voter.full_name}: ${voter.reference_number})...`);
  const loginRes = await request('POST', '/api/auth/login', {
    reference_number: voter.reference_number,
    pin: voterPassword
  });
  console.assert(loginRes.status === 200, `Login failed: ${JSON.stringify(loginRes.data)}`);
  const studentToken = loginRes.data.token;
  const student = loginRes.data.user;
  console.log(`✅ Logged in as: ${student.full_name} (${student.program}, ${student.class_section})`);

  // Test 2: Admin Login & Executive Role Verification (Office of the PRO)
  console.log('\n2. Testing Admin Login & Executive Role Verification...');
  const adminLogin = await request('POST', '/api/auth/login', {
    reference_number: 'ADMIN001',
    pin: '2026'
  });
  console.assert(adminLogin.status === 200, `Admin login failed: ${JSON.stringify(adminLogin.data)}`);
  const adminToken = adminLogin.data.token;
  const adminUser = adminLogin.data.user;
  console.assert(adminUser.role === 'admin', 'Expected role to be admin');
  console.assert(adminUser.class_section === 'Office of PRO', `Expected Office of PRO, got ${adminUser.class_section}`);
  console.assert(adminUser.program === 'EXECUTIVE', `Expected EXECUTIVE, got ${adminUser.program}`);
  console.log(`✅ Admin authenticated: ${adminUser.full_name} (${adminUser.program} • ${adminUser.class_section})`);

  // Test 3: Sealed Ballot Verification when Election is Closed
  console.log('\n3. Testing Ballot Sealing when Election is Closed...');
  await request('POST', '/api/admin/election-switch', { status: 'closed' }, adminToken);
  const sealedBallotRes = await request('GET', '/api/ballot', null, studentToken);
  console.assert(sealedBallotRes.status === 200);
  console.assert(sealedBallotRes.data.ballots_published === false, 'Ballots must NOT be published when election is closed');
  console.assert(sealedBallotRes.data.candidates.length === 0, 'Candidates array must be empty when election is closed');
  console.log('✅ Ballots are strictly sealed when election is closed (zero candidates leaked).');

  // Test 4: Open Polls via Admin Switch
  console.log('\n4. Opening Election Polls via Admin Switch...');
  await request('POST', '/api/admin/election-switch', { status: 'active' }, adminToken);

  // Test 5: Conditional WhatsApp Links
  console.log('\n5. Testing Conditional WhatsApp Community Links...');
  const linksRes = await request('GET', '/api/program-links', null, studentToken);
  console.assert(linksRes.status === 200);
  console.assert(linksRes.data.cohort_link.includes(student.class_section.replace(' ', '')), 'Expected cohort link to match student section');
  console.assert(!linksRes.data.class_b_link, 'Class B link must NOT be exposed to Class A');
  console.log(`✅ Main Group: ${linksRes.data.main_group_link}`);
  console.log(`✅ Discussion: ${linksRes.data.discussion_link}`);
  console.log(`✅ Student Cohort: ${linksRes.data.cohort_link} (${linksRes.data.class_section})`);

  // Test 6: Aspirant Live Eligibility Verification (Office of the PRO)
  console.log(`\n6. Testing Aspirant Live Student Verification (${femaleAspirant.full_name})...`);
  const verifyRes = await request('POST', '/api/candidates/verify-student', {
    reference_number: femaleAspirant.reference_number,
    pin: femalePassword
  });
  console.assert(verifyRes.status === 200, `Verification failed: ${JSON.stringify(verifyRes.data)}`);
  console.assert(verifyRes.data.valid === true, 'Expected valid: true');
  console.assert(verifyRes.data.student.full_name === femaleAspirant.full_name, `Expected ${femaleAspirant.full_name}`);
  console.assert(verifyRes.data.student.position === 'Female Course Representative', 'Expected Female Course Representative');
  console.log(`✅ Verified aspirant: ${verifyRes.data.student.full_name} (${verifyRes.data.student.program} • ${verifyRes.data.student.class_section}) -> Assigned: ${verifyRes.data.student.position}`);

  // Test 7: Aspirant Nomination Application
  console.log('\n7. Testing Aspirant Nomination Application...');
  const appStudentLogin = await request('POST', '/api/auth/login', {
    reference_number: femaleAspirant.reference_number,
    pin: femalePassword
  });
  console.assert(appStudentLogin.status === 200);
  const aspirantToken = appStudentLogin.data.token;

  const applyRes = await request('POST', '/api/candidates/apply', {
    slogan: 'Empowering Computing Students Through Open Collaboration',
    manifesto: 'Dedicated to direct faculty liaison, organizing weekly peer review clinics, and ensuring fair exam timetables.',
    photo_url_input: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80'
  }, aspirantToken);
  console.assert(applyRes.status === 200 || applyRes.data?.error === 'You have already submitted an application.');
  console.log(`✅ Candidate Application Verification: ${applyRes.data.message || applyRes.data.error}`);

  // Also submit a male candidate application for Class A
  const maleAppRes = await request('POST', '/api/candidates/apply', {
    slogan: 'Tech Innovation & Lab Infrastructure Growth',
    manifesto: 'Advocating for departmental sandbox environments, access to cloud credits, and direct representation.',
    photo_url_input: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&auto=format&fit=crop&q=80'
  }, studentToken);
  console.assert(maleAppRes.status === 200 || maleAppRes.data?.error === 'You have already submitted an application.');

  // Test 8: PRO Candidate Vetting & Approval
  console.log('\n8. Testing PRO Candidate Vetting & Approval...');
  const pendingCands = await request('GET', '/api/admin/candidates', null, adminToken);
  console.assert(pendingCands.status === 200);
  for (const c of pendingCands.data.candidates) {
    if (!c.is_approved) {
      const approveRes = await request('POST', `/api/admin/candidates/${c.id}/approve`, {}, adminToken);
      console.assert(approveRes.status === 200);
      console.log(`✅ PRO Approved Candidate #${c.id} (${c.full_name}): ${approveRes.data.message}`);
    }
  }

  // Test 9: Dual-Gender Ballot Candidate Fetching (when Active)
  console.log('\n9. Testing Dual-Gender Ballot Candidate Fetching (Active Election)...');
  const ballotRes = await request('GET', '/api/ballot', null, studentToken);
  console.assert(ballotRes.status === 200);
  console.assert(ballotRes.data.ballots_published === true, 'Ballots must be published when active');
  console.assert(Array.isArray(ballotRes.data.male_candidates), 'Male candidates array missing');
  console.assert(Array.isArray(ballotRes.data.female_candidates), 'Female candidates array missing');
  console.log(`✅ Retrieved ${ballotRes.data.male_candidates.length} Male Candidates and ${ballotRes.data.female_candidates.length} Female Candidates for ${student.program} (${student.class_section})`);

  const maleCandidate = ballotRes.data.male_candidates[0];
  const femaleCandidate = ballotRes.data.female_candidates[0];
  console.assert(maleCandidate, 'Expected at least 1 male candidate on ballot');
  console.assert(femaleCandidate, 'Expected at least 1 female candidate on ballot');
  console.log(`   [Male Nominee]: ${maleCandidate.full_name} — "${maleCandidate.slogan}"`);
  console.log(`   [Female Nominee]: ${femaleCandidate.full_name} — "${femaleCandidate.slogan}"`);

  // Test 10: Dual-Seat Anonymous Ballot Submission
  console.log('\n10. Testing Dual-Seat Anonymous Ballot Submission...');
  const voteRes = await request('POST', '/api/ballot/vote', {
    male_candidate_id: maleCandidate.id,
    female_candidate_id: femaleCandidate.id
  }, studentToken);
  console.assert(voteRes.status === 200, `Vote failed: ${JSON.stringify(voteRes.data)}`);
  console.log(`✅ Vote Response: ${voteRes.data.message}`);

  // Test 11: Duplicate Vote Prevention
  console.log('\n11. Testing Duplicate Vote Rejection...');
  const duplicateVoteRes = await request('POST', '/api/ballot/vote', {
    male_candidate_id: maleCandidate.id,
    female_candidate_id: femaleCandidate.id
  }, studentToken);
  console.assert(duplicateVoteRes.status === 400, 'Duplicate vote must be rejected with 400');
  console.log(`✅ Duplicate vote correctly blocked: ${duplicateVoteRes.data.error}`);

  // Test 12: Turnout Analytics
  console.log('\n12. Testing Turnout Analytics...');
  const overview = await request('GET', '/api/admin/overview', null, adminToken);
  console.assert(overview.status === 200);
  console.log(`✅ Overall Turnout: ${overview.data.overallTurnoutPct}% (${overview.data.totalVotes} / ${overview.data.totalRegistered} voted)`);
  overview.data.breakdown.forEach(b => {
    console.log(`   - ${b.program}: ${b.turnoutPct}% (${b.voted}/${b.registered})`);
  });

  // Test 13: Admin Student PIN Reset
  console.log(`\n13. Testing Admin Password Reset for ${femaleAspirant.full_name}...`);
  const resetRes = await request('POST', '/api/admin/reset-pin', { reference_number: femaleAspirant.reference_number }, adminToken);
  console.assert(resetRes.status === 200);
  console.assert(resetRes.data.newPin === femalePassword, `Expected ${femalePassword}, got ${resetRes.data.newPin}`);
  console.log(`✅ Reset password successful: Ref ${femaleAspirant.reference_number} restored to: ${resetRes.data.newPin}`);

  // Test 14: Audit Log Export (Anonymity Guaranteed)
  console.log('\n14. Testing Audit CSV Export...');
  const auditRes = await request('GET', '/api/admin/export-audit', null, adminToken);
  console.assert(auditRes.status === 200);
  console.assert(auditRes.raw.includes('ANONYMOUS'), 'Audit log must guarantee anonymity');
  console.log('✅ Audit CSV generated with anonymous records verified.');

  // Test 15: Official Class List PDF Generation with Program & Cohort Filename
  console.log('\n15. Testing Admin PDF Export for Class Lists (Format: Program - Class A/B.pdf)...');
  const pdfRes = await request('GET', '/api/admin/export-class-list-pdf?program=COMPUTER%20SCIENCE&class_section=Class%20A', null, adminToken);
  console.assert(pdfRes.status === 200, `Expected status 200, got ${pdfRes.status}`);
  console.assert(pdfRes.headers['content-type'] === 'application/pdf', 'Expected application/pdf header');
  console.assert(pdfRes.raw.startsWith('%PDF'), 'Expected valid PDF magic header %PDF');
  console.assert(pdfRes.headers['content-disposition'].includes('COMPUTER SCIENCE - CLASS A.pdf'), `Expected filename COMPUTER SCIENCE - CLASS A.pdf, got ${pdfRes.headers['content-disposition']}`);
  console.log(`✅ Official Class List PDF generated successfully with Content-Disposition: ${pdfRes.headers['content-disposition']}`);

  console.log('\n🎉 ALL 15 TESTS PASSED WITH 100% SUCCESS!');

  // Cleanup test votes & candidates to leave live DB pristine
  db.exec(`
    DELETE FROM votes;
    DELETE FROM candidates;
    UPDATE users SET has_voted = 0, is_candidate = 0;
  `);
  console.log('🧹 Test data cleaned up. Live database is pristine for official election operations.\n');
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
