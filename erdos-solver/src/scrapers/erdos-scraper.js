import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

export class ErdosProblemScraper {
  constructor() {
    this.baseUrl = 'https://www.erdosproblems.com';
    this.prizeTiers = [1000, 500, 250, 100, 50, 25];
  }

  /**
   * Scrape all problems from a prize tier
   */
  async scrapePrizeTier(amount) {
    const url = `${this.baseUrl}/prizes/${amount}`;
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const problems = [];
    
    // Parse problem list
    // Note: Actual selectors may need adjustment based on real website structure
    $('.problem-entry, .problem, [data-problem-id]').each((i, el) => {
      const $el = $(el);
      const id = $el.attr('data-problem-id') || $el.find('[data-problem-id]').attr('data-problem-id');
      const title = $el.find('.problem-title, h2, h3').first().text().trim();
      const status = $el.find('.status, [class*="status"]').text().trim();
      const area = $el.find('.area, [class*="area"]').text().trim();
      
      if (id && title) {
        problems.push({
          id: parseInt(id),
          prize: amount,
          title,
          status: status.toLowerCase() || 'open',
          area: area || 'unknown',
          url: `${this.baseUrl}/${id}`
        });
      }
    });
    
    return problems;
  }

  /**
   * Scrape detailed problem page
   */
  async scrapeProblemDetail(problemId) {
    const url = `${this.baseUrl}/${problemId}`;
    const response = await fetch(url);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    return {
      id: problemId,
      statement: $('.problem-statement, .statement, main p').first().text().trim(),
      history: $('.problem-history, .history, [class*="history"]').text().trim(),
      references: this._parseReferences($),
      relatedProblems: this._parseRelated($),
      tags: $('.tag, [class*="tag"]').map((i, el) => $(el).text().trim()).get(),
      lastUpdated: $('.last-updated, [class*="updated"]').text().trim(),
      knownResults: this._parseKnownResults($)
    };
  }

  _parseReferences($) {
    return $('.reference, [class*="reference"]').map((i, el) => {
      const $el = $(el);
      return {
        type: $el.attr('data-ref-type') || this._inferRefType($el),
        id: $el.attr('data-ref-id') || $el.attr('href')?.match(/\/([^\/]+)$/)?.[1],
        title: $el.find('.ref-title, .title').text().trim() || $el.text().trim(),
        url: $el.attr('href')
      };
    }).get();
  }

  _inferRefType($el) {
    const href = $el.attr('href') || '';
    const text = $el.text().toLowerCase();
    
    if (href.includes('arxiv.org') || text.includes('arxiv')) return 'arxiv';
    if (href.includes('oeis.org') || text.includes('oeis')) return 'oeis';
    if (href.includes('.pdf') || text.includes('paper')) return 'paper';
    if (href.includes('blog') || text.includes('blog')) return 'blog';
    return 'unknown';
  }

  _parseKnownResults($) {
    return $('.known-result, [class*="result"]').map((i, el) => {
      const $el = $(el);
      return {
        result: $el.find('.result-statement, .statement').text().trim() || $el.text().trim(),
        author: $el.find('.author, [class*="author"]').text().trim(),
        year: parseInt($el.find('.year, [class*="year"]').text().trim()) || null,
        reference: $el.find('.reference, a').attr('href')
      };
    }).get();
  }

  _parseRelated($) {
    return $('.related-problem, [data-problem-id]').map((i, el) => {
      const id = $(el).attr('data-problem-id');
      return id ? parseInt(id) : null;
    }).get().filter(id => id !== null);
  }

  /**
   * Scrape all problems (main entry point)
   */
  async scrapeAll() {
    const allProblems = [];
    
    for (const tier of this.prizeTiers) {
      console.log(`Scraping prize tier: $${tier}...`);
      const problems = await this.scrapePrizeTier(tier);
      
      for (const problem of problems) {
        console.log(`  Problem #${problem.id}: ${problem.title}`);
        try {
          const detail = await this.scrapeProblemDetail(problem.id);
          allProblems.push({ ...problem, ...detail });
        } catch (error) {
          console.error(`  Error scraping problem #${problem.id}:`, error.message);
          allProblems.push(problem); // Add basic info even if detail fails
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return allProblems;
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('erdos-scraper.js')) {
  const scraper = new ErdosProblemScraper();
  const problems = await scraper.scrapeAll();
  
  console.log(`\nScraped ${problems.length} problems`);
  console.log(JSON.stringify(problems, null, 2));
}

