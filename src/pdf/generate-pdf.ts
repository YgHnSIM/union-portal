import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadContentGraph } from '../domain/content-graph.js';

export type PdfPaperSize = 'A2' | 'A3' | 'A4';

export interface GeneratePdfOptions {
  projectRoot: string;
  docId: string;
  size?: PdfPaperSize;
  outPath?: string;
  siteDir?: string;
}

export interface GeneratePdfResult {
  docId: string;
  outPath: string;
  size: PdfPaperSize;
  pageCount: number;
  fileSize: number;
  browserPath: string;
}

const PAPER_PAGE_CSS: Record<PdfPaperSize, string> = {
  A2: '@page { size: 420mm 594mm; margin: 10mm 15mm; }',
  A3: '@page { size: 297mm 420mm; margin: 8mm 10mm; }',
  A4: '@page { size: 210mm 297mm; margin: 12mm; }',
};

export function findBrowserExecutable(): string {
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  throw new Error(
    'Chrome 또는 Edge 실행 파일을 찾을 수 없습니다. CHROME_PATH 환경변수를 설정해 주세요.',
  );
}

export async function generateDocumentPdf(
  options: GeneratePdfOptions,
): Promise<GeneratePdfResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const siteDir = path.resolve(options.siteDir ?? path.join(projectRoot, '_site'));
  const graph = loadContentGraph(projectRoot);
  const doc = graph.documentsById.get(options.docId);
  if (!doc) {
    throw new Error(`문서를 찾을 수 없습니다: ${options.docId}`);
  }

  const builtHtmlPath = path.join(siteDir, ...doc.route.split('/'));
  if (!fs.existsSync(builtHtmlPath)) {
    throw new Error(
      `빌드된 HTML 파일이 없습니다(${builtHtmlPath}). 먼저 build-site를 실행해 주세요.`,
    );
  }

  const size: PdfPaperSize =
    options.size ??
    (doc.category === 'statement' ? 'A2' : doc.category === 'newsletter' ? 'A3' : 'A4');

  const safeSlug = doc.id.replace(/[:/\\]/g, '_');
  const outPath = path.resolve(
    options.outPath ?? path.join(projectRoot, 'reports', 'pdf', `${safeSlug}_${size}.pdf`),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const browserPath = findBrowserExecutable();
  const rawHtml = fs.readFileSync(builtHtmlPath, 'utf8');
  const injectedStyle = `<style>
  ${PAPER_PAGE_CSS[size]}
  @media print {
    :root, body { color-scheme: only light !important; background: #ffffff !important; }
    .no-print, .site-header, .site-footer, .document-tools, .newsletter-return-bar, .document-breadcrumb { display: none !important; }
  }
</style>`;
  const patchedHtml = rawHtml.includes('</head>')
    ? rawHtml.replace('</head>', `${injectedStyle}\n</head>`)
    : `${injectedStyle}\n${rawHtml}`;

  const tempHtmlPath = path.join(
    path.dirname(builtHtmlPath),
    `.tmp-pdf-${process.pid}-${Date.now()}.html`,
  );
  fs.writeFileSync(tempHtmlPath, patchedHtml, 'utf8');

  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      `--print-to-pdf=${outPath}`,
      pathToFileURL(tempHtmlPath).href,
    ];
    const res = spawnSync(browserPath, args, { encoding: 'utf8' });
    if (res.error) throw res.error;
    if (res.status !== 0 && !fs.existsSync(outPath)) {
      throw new Error(
        `브라우저 PDF 생성 실패 (code=${res.status}): ${res.stderr || res.stdout}`,
      );
    }
    if (!fs.existsSync(outPath)) {
      throw new Error(`PDF 파일이 생성되지 않았습니다: ${outPath}`);
    }
    const buf = fs.readFileSync(outPath, 'latin1');
    const pageCount = (buf.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const fileSize = fs.statSync(outPath).size;
    return { docId: doc.id, outPath, size, pageCount, fileSize, browserPath };
  } finally {
    if (fs.existsSync(tempHtmlPath)) {
      fs.rmSync(tempHtmlPath, { force: true });
    }
  }
}
