const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'dist', 'model-api-check', 'results.json');

async function runLiveChecks() {
  const { app, safeStorage } = require('electron');
  const { MODEL_OPTIONS } = require('../src/model-config');
  const { mainHarness } = require('../tests/main-harness');
  const profile = process.env.WHALE_MODEL_CHECK_PROFILE;
  if (!profile) throw new Error('Run with node scripts/verify-model-api.cjs.');
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  await app.whenReady();
  const report = { checkedAt: new Date().toISOString(), endpoint: 'https://api.deepseek.com/responses', checks: [] };
  const cleanup = [];
  try {
    const secretFile = path.join(app.getPath('appData'), 'whale-girl', 'deepseek-key.bin');
    report.credentialState = { encryptedFileExists: fs.existsSync(secretFile), encryptionAvailable: safeStorage.isEncryptionAvailable() };
    if (!report.credentialState.encryptionAvailable || !report.credentialState.encryptedFileExists) {
      throw new Error('SAVED_KEY_UNAVAILABLE');
    }
    let apiKey;
    try { apiKey = safeStorage.decryptString(fs.readFileSync(secretFile)).trim(); }
    catch { throw new Error('SAVED_KEY_DECRYPTION_FAILED'); }
    if (!apiKey) throw new Error('SAVED_KEY_UNAVAILABLE');
    for (const { id } of MODEL_OPTIONS) {
      const entry = { requestedModel: id, requestedEffort: 'max', passed: false };
      report.checks.push(entry);
      let requests = 0;
      try {
        const harness = await mainHarness({ after: (callback) => cleanup.push(callback) }, {
          apiKey,
          saved: { modelId: id },
          fetchImpl: async (url, options) => {
            if (String(url) !== report.endpoint || ++requests > 1) throw new Error('UNEXPECTED_VERIFICATION_REQUEST');
            const body = JSON.parse(options.body);
            if (body.model !== id || body.reasoning?.effort !== 'max') throw new Error('PRODUCTION_MODEL_CONFIG_MISMATCH');
            const response = await fetch(url, {
              ...options,
              redirect: 'error',
              body: JSON.stringify({ ...body, max_output_tokens: 512 }),
              signal: AbortSignal.any([options.signal, AbortSignal.timeout(60000)]),
            });
            entry.httpStatus = response.status;
            const data = await response.clone().json().catch(() => ({}));
            entry.responseStatus = ['completed', 'incomplete', 'failed'].includes(data.status) ? data.status : 'unknown';
            entry.returnedModel = typeof data.model === 'string' && /^[\w.-]{1,100}$/.test(data.model) ? data.model : null;
            entry.returnedEffort = ['none', 'low', 'high', 'max'].includes(data.reasoning?.effort) ? data.reasoning.effort : null;
            entry.usage = {
              inputTokens: Number.isFinite(data.usage?.input_tokens) ? data.usage.input_tokens : null,
              outputTokens: Number.isFinite(data.usage?.output_tokens) ? data.usage.output_tokens : null,
              reasoningTokens: Number.isFinite(data.usage?.output_tokens_details?.reasoning_tokens)
                ? data.usage.output_tokens_details.reasoning_tokens : null,
            };
            return response;
          },
        });
        const saved = await harness.invoke('settings:save', { modelId: id });
        if (saved.modelId !== id || saved.reasoningEffort !== 'max') throw new Error('PRODUCTION_MODEL_CONFIG_MISMATCH');
        const answer = await harness.invoke('chat:send', '请原样回复两个大写字母：OK');
        const familyMatches = id === 'deepseek-flash' ? /flash/i.test(entry.returnedModel || '') : /pro/i.test(entry.returnedModel || '');
        entry.finalAnswerReceived = answer.kind === 'model' && typeof answer.text === 'string' && answer.text.trim().length > 0;
        entry.shortReplyConfirmed = entry.finalAnswerReceived && /^OK[。.!！\s]*$/i.test(answer.text.trim());
        entry.passed = entry.httpStatus === 200 && entry.responseStatus === 'completed'
          && familyMatches && entry.finalAnswerReceived && (!entry.returnedEffort || entry.returnedEffort === 'max');
        if (!entry.passed) entry.failure = 'MODEL_RESPONSE_NOT_VERIFIED';
      } catch (error) {
        const known = ['UNEXPECTED_VERIFICATION_REQUEST', 'PRODUCTION_MODEL_CONFIG_MISMATCH'];
        entry.failure = known.includes(error?.message) ? error.message : 'NETWORK_OR_SERVICE_FAILURE';
      }
    }
    apiKey = '';
  } catch (error) {
    report.failure = ['SAVED_KEY_UNAVAILABLE', 'SAVED_KEY_DECRYPTION_FAILED'].includes(error?.message) ? error.message : 'VERIFICATION_UNAVAILABLE';
  } finally {
    for (const remove of cleanup.reverse()) await remove();
    report.passed = report.checks.length === MODEL_OPTIONS.length && report.checks.every((entry) => entry.passed);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
}

function runIsolatedWorker() {
  if (process.platform !== 'win32') throw new Error('This check requires the saved Windows-encrypted app key.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-girl-model-check-'));
  try {
    const localStateFile = path.join(process.env.APPDATA, 'whale-girl', 'Local State');
    if (fs.existsSync(localStateFile)) {
      const localState = JSON.parse(fs.readFileSync(localStateFile, 'utf8'));
      if (typeof localState.os_crypt?.encrypted_key === 'string') {
        fs.writeFileSync(path.join(profile, 'Local State'), JSON.stringify({ os_crypt: {
          encrypted_key: localState.os_crypt.encrypted_key,
          audit_enabled: localState.os_crypt.audit_enabled === true,
        } }));
      }
    }
    const environment = { ...process.env, WHALE_MODEL_CHECK_PROFILE: profile };
    for (const name of ['ELECTRON_RUN_AS_NODE', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'DEBUG', 'NODE_OPTIONS']) delete environment[name];
    const result = require('node:child_process').spawnSync(require('electron'), [`--user-data-dir=${profile}`, __filename, '--live-model-worker'], {
      cwd: root, env: environment, stdio: 'inherit', windowsHide: true, timeout: 150000,
    });
    if (result.error) throw new Error('Live model verification did not finish within its deadline.');
    process.exitCode = result.status ?? 1;
  } finally {
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('whale-girl-model-check-')) {
      throw new Error('Unexpected verification profile path.');
    }
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

if (process.versions.electron && process.argv.includes('--live-model-worker')) {
  runLiveChecks().catch(() => { console.error('Live model verification could not start.'); require('electron').app.exit(1); });
} else {
  runIsolatedWorker();
}
