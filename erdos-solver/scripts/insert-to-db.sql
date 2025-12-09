-- Insert Mian-Chowla / Sidon Set problem (#340)

INSERT OR REPLACE INTO problems (id, prize, title, status, area, statement, history, last_updated, metadata)
VALUES (
  340,
  100,
  'Mian-Chowla Sequence / Sidon Set',
  'open',
  'combinatorics',
  'Find the largest Sidon set (B2 sequence) in {1, 2, ..., n}. A Sidon set is a set of integers where all pairwise sums a_i + a_j (i ≤ j) are distinct. The Mian-Chowla sequence is a greedy construction: start with a_1 = 1, then for each n, choose a_n to be the smallest integer greater than a_{n-1} such that all sums a_i + a_n (i ≤ n) are distinct. Erdős asked: What is the asymptotic growth rate of the largest Sidon set in {1, 2, ..., n}?',
  'Proposed by Erdős in the 1930s. The Mian-Chowla sequence was constructed in 1944.',
  '2024-01-01',
  '{"tags":["sidon-set","additive-combinatorics","sequences"],"related_problems":[341,342],"oeis":"A005282"}'
);

INSERT OR REPLACE INTO problem_references (problem_id, ref_type, ref_id, title, url)
VALUES
  (340, 'oeis', 'A005282', 'Mian-Chowla sequence', 'https://oeis.org/A005282'),
  (340, 'paper', 'mian-chowla-1944', 'On the B_2 sequences of Sidon', 'https://doi.org/10.1090/S0002-9939-1944-0011094-7');

INSERT OR REPLACE INTO known_results (problem_id, result_statement, author, year, reference_url)
VALUES
  (340, 'The Mian-Chowla sequence is a Sidon set with a(n) ~ n^3 asymptotically', 'Mian & Chowla', 1944, 'https://doi.org/10.1090/S0002-9939-1944-0011094-7'),
  (340, 'Optimal Sidon sets in {1, 2, ..., n} have size approximately sqrt(n)', 'Erdős & Turán', 1941, NULL);

