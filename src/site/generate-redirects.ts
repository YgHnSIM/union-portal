import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_REGISTRY } from '../domain/content-graph.js';
import { loadContentGraph } from '../storage/content-source.js';
import { SITE_BASE_URL, escapeAttr, escapeHtml } from './shell.js';

export interface GenerateRedirectsOptions {
  projectRoot: string;
  baseUrl?: string;
  outDir?: string;
}

export interface GenerateRedirectsResult {
  accountingRedirects: number;
  workplaceRedirects: number;
  outDir: string;
}

function renderRedirectHtml(targetUrl: string, label: string): string {
  const safeTarget = escapeAttr(targetUrl);
  const safeLabel = escapeHtml(label);
  const jsTarget = JSON.stringify(targetUrl).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>페이지 이전 안내 — ${safeLabel}</title>
  <meta name="robots" content="noindex,follow">
  <link rel="canonical" href="${safeTarget}">
  <meta http-equiv="refresh" content="0; url=${safeTarget}">
  <script>
    (function(){
      var target = ${jsTarget};
      var search = window.location.search || "";
      var hash = window.location.hash || "";
      window.location.replace(target + search + hash);
    })();
  </script>
</head>
<body style="font-family:sans-serif;max-width:640px;margin:48px auto;padding:0 20px;line-height:1.6;">
  <h1>통합 포털로 주소가 이전되었습니다</h1>
  <p>우체국물류지원단 물류노동조합 통합 포털(<strong>union-portal</strong>)로 이동합니다.</p>
  <p><a href="${safeTarget}">${safeTarget} 로 바로 이동 →</a></p>
</body>
</html>
`;
}

function writeRedirect(baseDir: string, relPosix: string, targetUrl: string, label: string): void {
  const outPath = path.join(baseDir, ...relPosix.split('/'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderRedirectHtml(targetUrl, label), 'utf8');
}

export async function generateRedirects(
  options: GenerateRedirectsOptions,
): Promise<GenerateRedirectsResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const baseUrl = (options.baseUrl ?? SITE_BASE_URL).replace(/\/+$/, '');
  const outRoot = path.resolve(options.outDir ?? path.join(projectRoot, 'redirects'));
  const accOut = path.join(outRoot, 'accounting');
  const wpOut = path.join(outRoot, 'workplace');

  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.mkdirSync(accOut, { recursive: true });
  fs.mkdirSync(wpOut, { recursive: true });

  // 1. Accounting legacy site redirects
  let accountingRedirects = 0;
  const staticAccMap: Array<[string, string, string]> = [
    ['index.html', `${baseUrl}/accounting/`, '회계 대시보드'],
    ['ledger.html', `${baseUrl}/accounting/ledger.html`, '공개 거래 탐색기'],
    ['coa.html', `${baseUrl}/accounting/coa.html`, '회계기준·단위'],
    ['reports/index.html', `${baseUrl}/accounting/reports/`, '재정 보고서 아카이브'],
  ];
  for (const [rel, target, label] of staticAccMap) {
    writeRedirect(accOut, rel, target, label);
    accountingRedirects += 1;
  }

  const ledgerPath = path.join(projectRoot, 'data', 'public', 'ledger_public.json');
  if (fs.existsSync(ledgerPath)) {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as {
      records: Array<{ ym: string; year: number }>;
    };
    const months = [...new Set(ledger.records.map((r) => r.ym).filter(Boolean))].sort();
    const years = [...new Set(ledger.records.map((r) => r.year).filter(Boolean))].sort();

    for (const ym of months) {
      writeRedirect(
        accOut,
        `reports/monthly/${ym}.html`,
        `${baseUrl}/accounting/reports/monthly/${ym}.html`,
        `${ym} 재정보고`,
      );
      accountingRedirects += 1;
    }
    for (const y of years) {
      writeRedirect(
        accOut,
        `reports/annual/${y}.html`,
        `${baseUrl}/accounting/reports/annual/${y}.html`,
        `${y}년 결산보고`,
      );
      accountingRedirects += 1;
    }
  }

  // 2. Workplace legacy site redirects
  let workplaceRedirects = 0;
  writeRedirect(wpOut, 'index.html', `${baseUrl}/archive/`, '공개 자료실');
  workplaceRedirects += 1;

  for (const cat of CATEGORY_REGISTRY) {
    writeRedirect(
      wpOut,
      `${cat.key}/index.html`,
      `${baseUrl}/archive/${cat.key}/`,
      cat.title,
    );
    workplaceRedirects += 1;
    if (cat.key === 'mom') {
      writeRedirect(wpOut, 'MoM/index.html', `${baseUrl}/archive/mom/`, cat.title);
      workplaceRedirects += 1;
    }
  }

  const graph = loadContentGraph(projectRoot);
  for (const doc of graph.documents) {
    if (doc.workflow.visibility === 'internal_only') continue;
    const legacyRel = doc.route.replace(/^archive\//, '');
    writeRedirect(wpOut, legacyRel, `${baseUrl}/${doc.route}`, doc.title);
    workplaceRedirects += 1;
    if (doc.category === 'mom') {
      const legacyUpperRel = legacyRel.replace(/^mom\//, 'MoM/');
      writeRedirect(wpOut, legacyUpperRel, `${baseUrl}/${doc.route}`, doc.title);
      workplaceRedirects += 1;
    }
  }

  return { accountingRedirects, workplaceRedirects, outDir: outRoot };
}
