// Script to insert a well-known Erdős problem into the database
// Problem #340: Mian-Chowla Sequence (Sidon Set Problem)

const problem = {
  id: 340,
  prize: 100,
  title: "Mian-Chowla Sequence / Sidon Set",
  status: "open",
  area: "combinatorics",
  statement: `Find the largest Sidon set (B2 sequence) in {1, 2, ..., n}. 
A Sidon set is a set of integers where all pairwise sums a_i + a_j (i ≤ j) are distinct.

The Mian-Chowla sequence is a greedy construction: start with a_1 = 1, 
then for each n, choose a_n to be the smallest integer greater than a_{n-1} 
such that all sums a_i + a_n (i ≤ n) are distinct.

Erdős asked: What is the asymptotic growth rate of the largest Sidon set in {1, 2, ..., n}?
Known: The Mian-Chowla sequence grows roughly as O(n^3) in terms of the largest element,
but the optimal Sidon set in {1, 2, ..., n} has size approximately sqrt(n).`,
  history: "Proposed by Erdős in the 1930s. The Mian-Chowla sequence was constructed in 1944.",
  last_updated: "2024-01-01",
  metadata: JSON.stringify({
    tags: ["sidon-set", "additive-combinatorics", "sequences"],
    related_problems: [341, 342],
    oeis: "A005282"
  })
};

const references = [
  {
    ref_type: "oeis",
    ref_id: "A005282",
    title: "Mian-Chowla sequence",
    url: "https://oeis.org/A005282"
  },
  {
    ref_type: "paper",
    ref_id: "mian-chowla-1944",
    title: "On the B_2 sequences of Sidon",
    url: "https://doi.org/10.1090/S0002-9939-1944-0011094-7"
  }
];

const knownResults = [
  {
    result_statement: "The Mian-Chowla sequence is a Sidon set with a(n) ~ n^3 asymptotically",
    author: "Mian & Chowla",
    year: 1944,
    reference_url: "https://doi.org/10.1090/S0002-9939-1944-0011094-7"
  },
  {
    result_statement: "Optimal Sidon sets in {1, 2, ..., n} have size approximately sqrt(n)",
    author: "Erdős & Turán",
    year: 1941,
    reference_url: null
  }
];

console.log("Problem data prepared:");
console.log(JSON.stringify({ problem, references, knownResults }, null, 2));

export { problem, references, knownResults };

