const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { db, initSchema } = require('./db');

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];

  function parseLine(line) {
    const values = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        values.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    values.push(cur);
    return values;
  }

  const headers = parseLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = vals[idx] !== undefined ? vals[idx].trim() : '';
    });
    row._lineNum = i + 1;
    rows.push(row);
  }
  return rows;
}

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

async function runMigration() {
  console.log('🔄 Running ACSES Real Roster Migration & Scrutiny...\n');
  initSchema();

  // 1. Clean out ALL mock data & votes
  console.log('🧹 Purging all mock data, candidates, and previous votes...');
  db.exec('DELETE FROM votes;');
  db.exec('DELETE FROM candidates;');
  db.exec("DELETE FROM users WHERE role != 'admin';");
  db.exec("UPDATE users SET has_voted = 0, is_candidate = 0;");

  // Clean uploads directory of any mock images
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(uploadsDir, f));
      } catch (_) { }
    }
    console.log(`🧹 Cleaned ${files.length} uploaded files in ${uploadsDir}`);
  }

  // 2. Ensure Program WhatsApp Community Links
  const programLinks = [
    {
      program: 'COMPUTER SCIENCE',
      main_group_link: 'https://chat.whatsapp.com/ACSES-CS-MainGroup-Official',
      discussion_link: 'https://chat.whatsapp.com/ACSES-CS-Discussion-Hub',
      class_a_link: 'https://chat.whatsapp.com/ACSES-CS-ClassA-Cohort',
      class_b_link: 'https://chat.whatsapp.com/ACSES-CS-ClassB-Cohort'
    },
    {
      program: 'CYBERSECURITY',
      main_group_link: 'https://chat.whatsapp.com/ACSES-CyberSec-Main-Official',
      discussion_link: 'https://chat.whatsapp.com/ACSES-CyberSec-Discussion',
      class_a_link: 'https://chat.whatsapp.com/ACSES-CyberSec-ClassA-Ops',
      class_b_link: 'https://chat.whatsapp.com/ACSES-CyberSec-ClassB-Ops'
    },
    {
      program: 'ROBOTICS & AI',
      main_group_link: 'https://chat.whatsapp.com/ACSES-RoboticsAI-MainGroup',
      discussion_link: 'https://chat.whatsapp.com/ACSES-RoboticsAI-LabHub',
      class_a_link: 'https://chat.whatsapp.com/ACSES-RoboticsAI-ClassA',
      class_b_link: 'https://chat.whatsapp.com/ACSES-RoboticsAI-ClassB'
    },
    {
      program: 'INFORMATION SYSTEMS & TECHNOLOGY',
      main_group_link: 'https://chat.whatsapp.com/ACSES-IST-EnterpriseMain',
      discussion_link: 'https://chat.whatsapp.com/ACSES-IST-PeerForum',
      class_a_link: 'https://chat.whatsapp.com/ACSES-IST-ClassA-Squad',
      class_b_link: 'https://chat.whatsapp.com/ACSES-IST-ClassB-Squad'
    }
  ];

  const upsertLink = db.prepare(`
    INSERT INTO program_links (program, main_group_link, discussion_link, class_a_link, class_b_link)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(program) DO UPDATE SET
      main_group_link = excluded.main_group_link,
      discussion_link = excluded.discussion_link,
      class_a_link = excluded.class_a_link,
      class_b_link = excluded.class_b_link
  `);

  for (const pl of programLinks) {
    upsertLink.run(pl.program, pl.main_group_link, pl.discussion_link, pl.class_a_link, pl.class_b_link);
  }
  console.log('✅ WhatsApp program community links configured.');

  // 3. Read and Scrutinize Roster CSV
  const defaultCsv = fs.existsSync(path.join(__dirname, 'updated list.csv')) ? 'updated list.csv' : 'list.csv';
  const targetFile = process.argv[2] || defaultCsv;
  const csvPath = path.isAbsolute(targetFile) ? targetFile : path.join(__dirname, targetFile);
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ Could not find CSV file at ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rawRows = parseCSV(csvContent);
  console.log(`📄 Total raw records parsed from ${path.basename(csvPath)}: ${rawRows.length}`);

  const refKey = Object.keys(rawRows[0]).find(k => k.includes('REFERENCE'));
  const nameKey = Object.keys(rawRows[0]).find(k => k.includes('FULLNAME') || k.includes('NAME'));
  const genderKey = Object.keys(rawRows[0]).find(k => k.includes('GENDER'));
  const phoneKey = Object.keys(rawRows[0]).find(k => k.includes('WHATSAPP'));
  const progKey = Object.keys(rawRows[0]).find(k => k.includes('PROGRAM'));

  const seenRefs = new Map();
  const rejectedNon26 = [];
  const rejectedDuplicates = [];
  const validStudents = [];

  for (const r of rawRows) {
    const rawRef = (r[refKey] || '').trim();
    const rawName = (r[nameKey] || '').trim().replace(/\s+/g, ' ');
    let rawGender = (r[genderKey] || '').trim().toUpperCase();
    const rawProgram = (r[progKey] || '').trim().toUpperCase();
    const rawPhone = (r[phoneKey] || '').trim();

    // Scrutiny 1: Reference number must end in 26
    if (!rawRef.endsWith('26')) {
      rejectedNon26.push({ line: r._lineNum, name: rawName, ref: rawRef, program: rawProgram });
      continue;
    }

    // Scrutiny 2: Reject duplicate reference numbers
    if (seenRefs.has(rawRef)) {
      const prev = seenRefs.get(rawRef);
      rejectedDuplicates.push({
        ref: rawRef,
        kept: { line: prev._lineNum, name: prev.full_name },
        dropped: { line: r._lineNum, name: rawName }
      });
      continue;
    }

    // Scrutiny 3: Gender normalization (handling Darko Nana Agyei anomaly)
    if (!rawGender || (rawGender !== 'MALE' && rawGender !== 'FEMALE')) {
      if (rawName.includes('Agyei') || rawName.includes('Kojo') || rawName.includes('Kwaku') || rawName.includes('Yaw')) {
        rawGender = 'MALE';
        console.log(`ℹ️ [Gender Inferred]: Line ${r._lineNum} ${rawName} assigned MALE`);
      } else {
        rawGender = 'MALE'; // Default fallback
      }
    }

    const studentRecord = {
      reference_number: rawRef,
      full_name: rawName,
      gender: rawGender,
      program: rawProgram,
      whatsapp_number: rawPhone,
      _lineNum: r._lineNum
    };

    seenRefs.set(rawRef, studentRecord);
    validStudents.push(studentRecord);
  }

  console.log('\n--- 📋 SCRUTINY REPORT ---');
  console.log(`❌ Discarded (Ref does not end in 26): ${rejectedNon26.length}`);
  rejectedNon26.forEach(rj => {
    console.log(`   - Line ${rj.line}: [${rj.ref}] ${rj.name} (${rj.program})`);
  });

  console.log(`\n❌ Discarded (Duplicate submissions): ${rejectedDuplicates.length}`);
  rejectedDuplicates.forEach(d => {
    console.log(`   - Ref: ${d.ref} | Kept: ${d.kept.name} (Line ${d.kept.line}) | Dropped: ${d.dropped.name} (Line ${d.dropped.line})`);
  });

  console.log(`\n✅ Total Validated Students to be enrolled: ${validStudents.length}\n`);

  // 4. Partition by Program & Assign Class Sections (Class A vs Class B)
  const byProgram = {};
  for (const s of validStudents) {
    if (!byProgram[s.program]) byProgram[s.program] = [];
    byProgram[s.program].push(s);
  }

  const enrolledStudents = [];

  for (const [program, progStudents] of Object.entries(byProgram)) {
    // Sort males and females alphabetically for clean, deterministic, balanced cohort distribution
    const males = progStudents
      .filter(s => s.gender === 'MALE')
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const females = progStudents
      .filter(s => s.gender === 'FEMALE')
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    // Evenly distribute males between Class A and Class B
    const classAMales = [];
    const classBMales = [];
    males.forEach((m, idx) => {
      if (idx % 2 === 0) classAMales.push({ ...m, class_section: 'Class A' });
      else classBMales.push({ ...m, class_section: 'Class B' });
    });

    // Evenly distribute females between Class A and Class B
    const classAFemales = [];
    const classBFemales = [];
    females.forEach((f, idx) => {
      if (idx % 2 === 0) classAFemales.push({ ...f, class_section: 'Class A' });
      else classBFemales.push({ ...f, class_section: 'Class B' });
    });

    const progEnrolled = [...classAMales, ...classAFemales, ...classBMales, ...classBFemales];
    enrolledStudents.push(...progEnrolled);

    console.log(`📊 [${program}] Total: ${progStudents.length}`);
    console.log(`   • Class A: ${classAMales.length + classAFemales.length} students (${classAMales.length} M / ${classAFemales.length} F)`);
    console.log(`   • Class B: ${classBMales.length + classBFemales.length} students (${classBMales.length} M / ${classBFemales.length} F)`);
  }

  // 5. Insert Valid Students into DB with Password Formula
  const saltRounds = 10;
  const insertUser = db.prepare(`
    INSERT INTO users (reference_number, full_name, gender, program, class_section, whatsapp_number, password_hash, has_voted, is_candidate, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 'voter')
    ON CONFLICT(reference_number) DO UPDATE SET
      full_name = excluded.full_name,
      gender = excluded.gender,
      program = excluded.program,
      class_section = excluded.class_section,
      whatsapp_number = excluded.whatsapp_number,
      password_hash = excluded.password_hash,
      has_voted = 0,
      is_candidate = 0,
      role = 'voter'
  `);

  console.log('\n🔒 Encrypting student passwords and inserting into database...');
  db.exec('BEGIN TRANSACTION;');
  try {
    for (let i = 0; i < enrolledStudents.length; i++) {
      const s = enrolledStudents[i];
      const studentPassword = getStudentPassword(s.full_name, s.whatsapp_number, s.program);
      const password_hash = bcrypt.hashSync(studentPassword, saltRounds);

      insertUser.run(
        s.reference_number,
        s.full_name,
        s.gender,
        s.program,
        s.class_section,
        s.whatsapp_number,
        password_hash
      );

      if ((i + 1) % 50 === 0 || i === enrolledStudents.length - 1) {
        process.stdout.write(`   • Enrolled & secured: ${i + 1}/${enrolledStudents.length} voters\r`);
      }
    }
    console.log('');
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
  console.log(`✅ Successfully enrolled ${enrolledStudents.length} official students.`);

  // 6. Ensure Administrator (Office of the PRO)
  const adminPinHash = bcrypt.hashSync('2026', saltRounds);
  const upsertAdmin = db.prepare(`
    INSERT INTO users (reference_number, full_name, gender, program, class_section, password_hash, has_voted, is_candidate, role)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'admin')
    ON CONFLICT(reference_number) DO UPDATE SET
      full_name = excluded.full_name,
      program = excluded.program,
      class_section = excluded.class_section,
      password_hash = excluded.password_hash,
      role = 'admin'
  `);
  upsertAdmin.run('ADMIN001', 'ACSES Public Relations Officer', 'FEMALE', 'EXECUTIVE', 'Office of PRO', adminPinHash);
  console.log('✅ Executive Administrator verified: ADMIN001 (ACSES Public Relations Officer • Executive) | PIN: 2026');

  // 7. Ensure Election Status is Active
  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  upsertSetting.run('election_status', 'active');
  console.log('✅ Election master switch set to: ACTIVE');

  console.log('\n🎉 Roster migration completed with 100% integrity.');
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
