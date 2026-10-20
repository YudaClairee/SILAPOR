import { readFileSync } from 'node:fs';
import { verifyReport } from '@silapor/ai';
import { prepareVisionImage } from '@silapor/storage';

const key = (readFileSync('../../.env', 'utf8').match(/^OPENROUTER_API_KEY=(.*)$/m)?.[1] ?? '').trim();
const description =
  'AC nya tidak dingin. Sepertinya nya ada yang rusak sparepart nya. Perlu dicek.';

const cases = [
  {
    name: 'FOTO AC + deskripsi AC (harus PASS)',
    file: '.data/attachments/staging_799dafae-5a90-4ddb-9fa0-5db6484b21e6',
  },
  { name: 'FOTO LOGO + deskripsi AC (harus FAIL: tidak cocok)', file: 'public/logo-upi.png' },
];

for (const item of cases) {
  const prepared = await prepareVisionImage(new Uint8Array(readFileSync(item.file)));
  const outcome = await verifyReport(
    {
      description,
      asset: {
        name: 'AC central',
        category: 'HVAC',
        building: 'DEWI SARTIKA',
        floor: 'Lantai 4 DEWI SARTIKA',
        room: 'RUANG KULIAH 19 (BIDI)',
      },
      photos: [
        {
          storageKey: 'test',
          contentType: prepared.mimeType,
          dataUrl: `data:${prepared.mimeType};base64,${Buffer.from(prepared.bytes).toString('base64')}`,
        },
      ],
      categories: ['ELECTRICAL', 'HVAC', 'FURNITURE', 'ELECTRONIC', 'PLUMBING'],
      issueTypes: [
        'BROKEN',
        'NOT_WORKING',
        'MISSING',
        'DIRTY',
        'LEAKING',
        'DANGEROUS',
        'OTHER',
        'NOT_COOLING',
        'LIGHT_OFF',
        'POWER_FAILURE',
        'NO_CONNECTION',
      ],
    },
    { timeoutMs: 20_000, model: 'google/gemini-2.5-flash-lite', apiKey: key },
  );
  console.log(`\n${item.name}\n  -> ${outcome.kind}`);
  if (outcome.kind === 'PASS') {
    console.log(`     ${outcome.category}/${outcome.issueType}/${outcome.priority}, confidence ${outcome.confidence}`);
  }
  if (outcome.kind === 'FAIL') {
    console.log(`     reason: ${outcome.reason.slice(0, 180)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
