import assert from 'node:assert/strict';
import test from 'node:test';
import { ForensicsService } from './forensics.service.ts';

test('maps the Python analyses payload onto Node modules', () => {
  const mapped = ForensicsService.mapPythonAnalyses({
    metadata: { findings: ['Software tag: Photoshop'], flags: ['editor'], data: { Software: 'Photoshop' } },
    ela: { confidence: 0.42, findings: ['Uneven recompression'], visualization: 'abc' },
    copy_move: { confidence: 0.1, findings: ['No duplicated blocks'] },
    noise: { confidence: 0.2, findings: ['Noise is consistent'] },
    splicing: { confidence: 0.8, findings: ['Edge inconsistency'], visualization: 'splice' },
    compression: { confidence: 0.3, findings: ['Block boundary shift'], visualization: 'jpeg' }
  });

  assert.equal(mapped.exif.details?.sourceName, 'EXIF Metadata Analysis');
  assert.equal(mapped.exif.subScore, 0.25);
  assert.equal(mapped.ela.subScore, 0.42);
  assert.equal(mapped.ela.heatmapBase64, 'abc');
  assert.equal(mapped.copyMove.subScore, 0.1);
  assert.equal(mapped.noise.subScore, 0.2);
  assert.equal(mapped.lighting.details?.sourceName, 'Image Splicing Detection');
  assert.equal(mapped.lighting.heatmapBase64, 'splice');
  assert.equal(mapped.deepfake.details?.sourceName, 'Compression Artifact Detection');
  assert.equal(mapped.deepfake.subScore, 0.3);
});

test('leaves modules not applicable when Python returns nothing', () => {
  const mapped = ForensicsService.mapPythonAnalyses(undefined);
  assert.equal(mapped.ela.status, 'not_applicable');
  assert.equal(mapped.ela.subScore, null);
});

test('fusion ignores modules without a numeric score', () => {
  const fused = ForensicsService.computeFusionScore({
    exif: 0.2,
    ela: null,
    copyMove: 0.2,
    noise: null,
    lighting: null,
    deepfake: null
  });
  assert.ok(fused.fusionScore >= 0 && fused.fusionScore <= 1);
  assert.equal(fused.authenticityLabel, 'Authentic');
  assert.ok(!('ela' in fused.normalizedWeights));
});
