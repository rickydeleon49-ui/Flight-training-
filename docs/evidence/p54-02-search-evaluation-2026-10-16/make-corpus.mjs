import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.argv[2];
if (!root) throw Error('Explicit scratch output directory required');
fs.mkdirSync(root, { recursive: true });
const topics = ['crosswind landing', 'density altitude', 'metar report', 'navigation chart', 'weather briefing', 'café planning', 'airspace chart', 'aircraft checklist'];
const inventory = [];
for (const count of [100, 1000, 10000]) {
  const documents = [];
  for (let material = 0; material < count; material++) {
    const materialId = `synthetic-material-${material}`;
    const hash = crypto.createHash('sha256').update(`synthetic-content-${material}`).digest('hex');
    for (let page = 1; page <= 6; page++) {
      const topic = topics[(material + page) % topics.length];
      const kind = page <= 4 ? 'pdf' : page === 5 ? 'guide' : 'note';
      documents.push({ id: `${materialId}:${kind}:${page}`, materialId, physicalPage: kind === 'pdf' ? page : null, contentSha256: hash,
        title: `Synthetic ${topic} ${material}`,
        body: `Material ${material}. ${kind} ${page}. ${topic}. ` +
          `This is synthetic evaluation text, not flight instruction. ${topic} source context and personal study organization. `.repeat(3) +
          (material === 0 && page === 1 ? ' uniqueoldmarker' : '') });
    }
  }
  const file = path.join(root, `corpus-${count}.json`);
  const bytes = JSON.stringify(documents);
  fs.writeFileSync(file, bytes);
  inventory.push({ materials: count, records: documents.length, pdfPages: count * 4, guideRecords: count, noteRecords: count, bytes: Buffer.byteLength(bytes), sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
fs.writeFileSync(path.join(root, 'corpus-identity.json'), JSON.stringify({ generator: 'deterministic-v1-no-randomness', syntheticOnly: true, datasets: inventory }, null, 2) + '\n');
