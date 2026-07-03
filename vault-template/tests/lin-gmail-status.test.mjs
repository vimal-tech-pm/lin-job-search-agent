import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import {
  jobOutcomeState,
  foldMatchesIntoJob,
  deriveStatus,
  updateJobStatus,
  classify,
} from '../scripts/lin-gmail-status.mjs';

test('classify treats generic application acknowledgements with interview boilerplate as acknowledgement', () => {
  const campus = `Thank you for applying for the Senior Product Manager position at Campus!
    We've received your application and our hiring team is currently reviewing all submissions.
    If your qualifications align with the role, a team member will reach out to schedule an introductory interview.`;
  assert.equal(classify(campus, 'Thank you for applying to Campus!'), 'acknowledgement');

  const wellfound = `Your application has been submitted! If there's a match, we will make an email introduction.
    You should hear back in 1-2 weeks. Schedule your first interview.`;
  assert.equal(classify(wellfound, 'Application to Siena AI successfully submitted'), 'acknowledgement');

  const jobAlert = `Ready to Interview Open to offers Closed to Offers Technical Product Manager at Jerry.ai`;
  assert.equal(classify(jobAlert, 'New jobs: Technical Product Manager, AI Engineering & Systems at Jerry.ai and 9 more jobs'), 'other');
});

test('classify keeps explicit interview invitations as interview', () => {
  const skimmer = `Thank you for applying to the Senior Product Manager role at Skimmer!
    We've reviewed your application, and we'd like to move to the next step in the interview process.
    We'd like to schedule a Get To Know You call.`;
  assert.equal(classify(skimmer, "Let's Talk: Get To Know You Call With Skimmer"), 'interview');

  const semperis = `This is a Microsoft Teams meeting. Thank you once again for considering Semperis.
    We appreciate your interest and look forward to meeting you.`;
  assert.equal(classify(semperis, 'Interview with Semperis for Senior Product Manager- Agentic AI'), 'interview');
});

test('deriveStatus maps an outcome state back to the legacy forward status', () => {
  assert.equal(deriveStatus({ outcome: 'rejected', furthest_stage: 'final' }), 'closed');
  assert.equal(deriveStatus({ outcome: 'offer', furthest_stage: 'offer' }), 'offer');
  assert.equal(deriveStatus({ outcome: null, furthest_stage: 'interviewing' }), 'interviewing');
  assert.equal(deriveStatus({ outcome: null, furthest_stage: 'final' }), 'interviewing');
  assert.equal(deriveStatus({ outcome: null, furthest_stage: 'applied' }), null); // ack only
});

test('foldMatchesIntoJob builds the high-water mark and lets the latest terminal email win', () => {
  const job = {}; // fresh applied job, no prior outcome fields
  const state = foldMatchesIntoJob(job, [
    { classification: 'rejection', subject: 'update', snippet: 'unfortunately', date: '2026-06-10' },
    { classification: 'interview', subject: 'Final round', snippet: 'onsite panel', date: '2026-06-05' },
    { classification: 'acknowledgement', subject: 'received', snippet: '', date: '2026-06-01' },
  ]);
  assert.equal(state.furthest_stage, 'final');  // depth from the interview email
  assert.equal(state.outcome, 'rejected');      // latest terminal email (the rejection)
});

test('foldMatchesIntoJob never clobbers a manual field on the job', () => {
  const job = { furthest_stage: 'final', furthest_stage_source: 'manual' };
  const state = foldMatchesIntoJob(job, [
    { classification: 'interview', subject: 'phone screen', snippet: '', date: '2026-06-09' },
  ]);
  assert.equal(state.furthest_stage, 'final');
  assert.equal(state.furthest_stage_source, 'manual');
});

test('updateJobStatus persists outcome/furthest_stage + sources without dropping manual', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lin-gs-'));
  const ymlPath = path.join(dir, 'job.yml');
  fs.writeFileSync(ymlPath, yaml.stringify({
    status: 'applied', title: 'Senior PM',
    furthest_stage: 'final', furthest_stage_source: 'manual', // user said it reached the final round
  }));

  const state = foldMatchesIntoJob(yaml.parse(fs.readFileSync(ymlPath, 'utf8')), [
    { classification: 'rejection', subject: 'decision', snippet: 'not moving forward', date: '2026-06-12' },
  ]);
  updateJobStatus(ymlPath, deriveStatus(state), 'rejection: decision (2026-06-12)', state);

  const after = yaml.parse(fs.readFileSync(ymlPath, 'utf8'));
  assert.equal(after.outcome, 'rejected');
  assert.equal(after.outcome_source, 'email');
  assert.equal(after.furthest_stage, 'final');          // manual depth preserved
  assert.equal(after.furthest_stage_source, 'manual');
  assert.equal(after.status, 'closed');                 // back-compat forward status still set
  fs.rmSync(dir, { recursive: true, force: true });
});

test('jobOutcomeState reads persisted fields into the canonical shape', () => {
  assert.deepEqual(
    jobOutcomeState({ outcome: 'offer', furthest_stage: 'offer', outcome_source: 'email' }),
    { outcome: 'offer', furthest_stage: 'offer', outcome_source: 'email', furthest_stage_source: 'email' },
  );
});
