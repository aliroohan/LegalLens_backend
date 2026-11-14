/**
 * Minimal single-page PDF writer for case report summaries.
 * Keeps report export inside Node and does not call the Python report service.
 */
export function buildTextPdf(title: string, lines: string[]): Buffer {
  const escaped = [title, '', ...lines]
    .map((line) => line.replace(/[()\\]/g, (char) => `\\${char}`).slice(0, 110))
    .slice(0, 42);

  const commands = ['BT', '/F1 11 Tf', '50 780 Td', '14 TL'];
  escaped.forEach((line, index) => {
    if (index === 0) {
      commands.push(`(${line}) Tj`);
    } else {
      commands.push(`T* (${line}) Tj`);
    }
  });
  commands.push('ET');
  const stream = commands.join('\n');

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
