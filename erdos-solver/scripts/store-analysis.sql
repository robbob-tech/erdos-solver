-- Store analysis results for Problem #340

-- Insert signature data
INSERT OR REPLACE INTO signatures (problem_id, signature_type, data, metadata)
VALUES (
  340,
  'rh_trace',
  '{"anomalyScores":[0.9611,0.9791,1.0000],"windows":3,"avgAnomaly":0.9791}',
  '{"encoding":"gaps","sequence_length":260,"scales":[64,256,1024]}'
);

INSERT OR REPLACE INTO signatures (problem_id, signature_type, data, metadata)
VALUES (
  340,
  'numerical',
  '{"signatures":160,"type":"numerical"}',
  '{"encoding":"values","sequence_length":260,"stats_computed":true}'
);

-- Insert computational conjectures
INSERT OR REPLACE INTO conjectures (problem_id, statement, rationale, status, kk_score, anomaly_score)
VALUES
  (340, 
   'The Mian-Chowla sequence a(n) grows approximately as O(n^3) where n is the index',
   'Empirical observation: Average a(n)/n^3 = 0.0644. Computational verification shows cubic growth pattern consistent with known theory.',
   'experimental',
   0.64,
   0.98
  ),
  (340,
   'The density of Mian-Chowla sequence in {1, 2, ..., a(n)} is approximately 0.44 * sqrt(a(n))',
   'Computational analysis: For 260-term sequence with max value 348110, density ratio is 0.44x optimal. This is consistent with greedy construction being suboptimal but asymptotically similar.',
   'experimental',
   0.44,
   0.98
  ),
  (340,
   'Gaps in Mian-Chowla sequence are mostly increasing (68% increasing transitions)',
   'Greedy construction ensures each new term is minimal, leading to increasing gaps. Computational verification: 68% of gap transitions are increasing.',
   'experimental',
   0.68,
   0.98
  );

