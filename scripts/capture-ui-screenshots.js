import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREENSHOT_DIR = path.resolve('docs/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json');
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {}
    await sleep(200);
  }
  throw new Error('Could not connect to Chrome debugging port 9222');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`✓ Saved screenshot: ${filename} (${buffer.length} bytes)`);
    return outPath;
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('=== Capturing Production UI Screenshots (Targeted) ===');

  const chromeProc = spawn(
    CHROME_PATH,
    [
      '--headless',
      '--remote-debugging-port=9222',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1600,1050',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await getDebuggerUrl();
    const client = new CDPClient(wsUrl);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');

    console.log('Navigating to http://localhost:3000 ...');
    await client.send('Page.navigate', { url: 'http://localhost:3000' });
    await sleep(3500);

    // 1. Overview
    await client.captureScreenshot('01_control_room_overview.png');

    // 2. Click Incidents nav in sidebar
    await client.eval(`
      (() => {
        const sideBtns = Array.from(document.querySelectorAll('aside button, div[class*="w-64"] button'));
        const incBtn = sideBtns.find(b => b.textContent && b.textContent.includes('Incidents'));
        if (incBtn) incBtn.click();
      })()
    `);
    await sleep(1500);

    // Click "All Incidents" back button to show the full table catalog
    await client.eval(`
      (() => {
        const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('All Incidents'));
        if (backBtn) backBtn.click();
      })()
    `);
    await sleep(1200);
    await client.captureScreenshot('02_live_incidents_catalog.png');

    // Select the freshly diagnosed REMEDIATION_PROPOSED checkout-api incident row
    await client.eval(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tbody tr, div[class*="cursor-pointer"]'));
        const match = rows.find(r => r.textContent && (r.textContent.includes('REMEDIATION_PROPOSED') || r.textContent.includes('PROPOSED')));
        if (match) {
          match.click();
        } else if (rows[0]) {
          rows[0].click();
        }
      })()
    `);
    await sleep(1500);

    // 3. AI RCA Hypotheses Tab
    await client.eval(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const aiTab = tabs.find(t => t.textContent && t.textContent.trim() === 'AI');
        if (aiTab) aiTab.click();
      })()
    `);
    await sleep(1000);
    await client.captureScreenshot('03_incident_ai_rca_hypotheses.png');

    // 4. Evidence Vault Tab
    await client.eval(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const evTab = tabs.find(t => t.textContent && t.textContent.trim() === 'Evidence');
        if (evTab) evTab.click();
      })()
    `);
    await sleep(1000);
    await client.captureScreenshot('04_incident_evidence_vault.png');

    // 5. Remediation & Approvals Tab
    await client.eval(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const remTab = tabs.find(t => t.textContent && t.textContent.trim() === 'Remediation');
        if (remTab) remTab.click();
      })()
    `);
    await sleep(1000);
    await client.captureScreenshot('05_incident_remediation_approval.png');

    // 6. Postmortem Tab
    await client.eval(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const pmTab = tabs.find(t => t.textContent && t.textContent.trim() === 'Postmortem');
        if (pmTab) pmTab.click();
      })()
    `);
    await sleep(1000);
    await client.captureScreenshot('06_incident_postmortem.png');

    // 7. Infrastructure nav
    await client.eval(`
      (() => {
        const sideBtns = Array.from(document.querySelectorAll('aside button, div[class*="w-64"] button'));
        const infraBtn = sideBtns.find(b => b.textContent && b.textContent.includes('Infrastructure'));
        if (infraBtn) infraBtn.click();
      })()
    `);
    await sleep(1500);
    await client.captureScreenshot('07_infrastructure_azure_aks.png');

    // 8. SLOs nav
    await client.eval(`
      (() => {
        const sideBtns = Array.from(document.querySelectorAll('aside button, div[class*="w-64"] button'));
        const sloBtn = sideBtns.find(b => b.textContent && b.textContent.includes('SLOs'));
        if (sloBtn) sloBtn.click();
      })()
    `);
    await sleep(1500);
    await client.captureScreenshot('08_slo_and_error_budget.png');

    // 9. EU Compliance & WORM Audit Ledger
    await client.eval(`
      (() => {
        const sideBtns = Array.from(document.querySelectorAll('aside button, div[class*="w-64"] button'));
        const audBtn = sideBtns.find(b => b.textContent && b.textContent.includes('Audit'));
        if (audBtn) audBtn.click();
      })()
    `);
    await sleep(1500);
    await client.captureScreenshot('09_eu_compliance_audit_ledger.png');

    client.close();
    console.log('=== All Targeted Screenshots Captured Successfully! ===');
  } finally {
    chromeProc.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
