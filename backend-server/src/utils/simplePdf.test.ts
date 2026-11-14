import assert from 'node:assert/strict';
import test from 'node:test';
import { registerSchema } from '../validators/auth.validator.ts';
import { buildTextPdf } from './simplePdf.ts';

test('public registration cannot request a super admin role', () => {
  const parsed = registerSchema.safeParse({
    email: 'person@example.com',
    password: 'secret1',
    name: 'Person',
    role: 'super_admin'
  });
  assert.equal(parsed.success, false);
});

test('case summary PDF is a real PDF document', () => {
  const pdf = buildTextPdf('LegalLens report', ['Case: Demo', 'Score: 0.42']);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.includes(Buffer.from('%%EOF')));
});
