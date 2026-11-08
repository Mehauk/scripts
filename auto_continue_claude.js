(() => {
  if (window.__claudeAutoContinue) {
    window.__claudeAutoContinue.stop();
  }

  const CONFIG = {
    PROMPT_TEXT: "continue",
    IDLE_WAIT_MS: 15 * 60 * 1000,
    POLL_DELAY_MS: 3000,          // Check DOM every 3 seconds
    COOLDOWN_MS: 8000,            // Wait 8s after sending before resuming polling
    MAX_RUNS: 50
  };

  let runCount = 0;
  let isRunning = true;
  let activeTimer = null;
  let isExecuting = false;
  
  // Tracks when the ready state began
  let idleStartTime = null;
  let lastLoggedMinute = null;

  function getClaudeDoc() {
    try {
      const frame = document.getElementById('active-frame');
      return (frame && frame.contentDocument) ? frame.contentDocument : document;
    } catch {
      return null;
    }
  }

  function scheduleNext(delay) {
    if (!isRunning) return;
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = setTimeout(tick, delay);
  }

  function cleanup() {
    isRunning = false;
    idleStartTime = null;
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    delete window.__claudeAutoContinue;
    delete window.stopAuto;
    window.removeEventListener('beforeunload', cleanup);
    console.log("%c[Auto-Continue] Stopped and cleaned up.", "color: red; font-weight: bold;");
  }

  // Safe injector for Claude's contenteditable plaintext-only div
  function typeIntoClaude(input, text) {
    const doc = input.ownerDocument;
    const win = doc.defaultView;

    input.focus();

    const sel = win.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);

    const success = doc.execCommand('insertText', false, text);
    if (!success || input.textContent !== text) {
      input.textContent = text;
      input.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    input.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  function tick() {
    if (!isRunning || isExecuting) return;

    if (runCount >= CONFIG.MAX_RUNS) {
      console.log("[Auto-Continue] Reached MAX_RUNS limit. Halting.");
      cleanup();
      return;
    }

    isExecuting = true;

    try {
      const doc = getClaudeDoc();
      if (!doc) {
        scheduleNext(CONFIG.POLL_DELAY_MS);
        return;
      }

      // 1. Is Claude currently working/thinking?
      const stopBtn = doc.querySelector('button[aria-label*="Stop" i], button[aria-label*="Cancel" i], button[class*="stopButton" i]');
      const isWorking = stopBtn && stopBtn.offsetParent !== null;

      if (isWorking) {
        // If it started working again during our countdown, CANCEL the timer
        if (idleStartTime !== null) {
          console.log("%c[Auto-Continue] Claude started working again! Canceled 30-minute timer.", "color: orange; font-weight: bold;");
          idleStartTime = null;
          lastLoggedMinute = null;
        }
        scheduleNext(CONFIG.POLL_DELAY_MS);
        return;
      }

      // 2. Claude is not working; check for Send button & input
      const sendBtn = doc.querySelector('button[aria-label="Send message"], button.sendButton_gGYT1w');
      const input = doc.querySelector('.messageInput_cKsPxg, [aria-label="Message input"], [contenteditable="plaintext-only"]');

      if (sendBtn && sendBtn.offsetParent !== null && input) {
        const now = Date.now();

        // If this is the first time we noticed it became idle, start the 30-min timer
        if (idleStartTime === null) {
          idleStartTime = now;
          lastLoggedMinute = Math.ceil(CONFIG.IDLE_WAIT_MS / 60000);
          console.log(`%c[Auto-Continue] Idle state detected. Waiting ${lastLoggedMinute} minutes before continuing...`, "color: #38bdf8; font-weight: bold;");
          scheduleNext(CONFIG.POLL_DELAY_MS);
          return;
        }

        const elapsed = now - idleStartTime;

        // Has the full 30 minutes elapsed without interruption?
        if (elapsed >= CONFIG.IDLE_WAIT_MS) {
          runCount++;
          console.log(`%c[Auto-Continue] 30 minutes elapsed with no activity. Submitting '${CONFIG.PROMPT_TEXT}' (#${runCount}/${CONFIG.MAX_RUNS})...`, "color: #4ade80; font-weight: bold;");

          idleStartTime = null;
          lastLoggedMinute = null;

          // Type text into contenteditable
          typeIntoClaude(input, CONFIG.PROMPT_TEXT);

          // Submit after short delay for React to acknowledge
          setTimeout(() => {
            sendBtn.disabled = false;
            sendBtn.click();
            const win = doc.defaultView;
            input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }, 200);

          scheduleNext(CONFIG.COOLDOWN_MS);
          return;
        }

        // Periodic status log every 5 minutes
        const remainingMinutes = Math.ceil((CONFIG.IDLE_WAIT_MS - elapsed) / 60000);
        if (remainingMinutes !== lastLoggedMinute && remainingMinutes % 5 === 0) {
          lastLoggedMinute = remainingMinutes;
          console.log(`[Auto-Continue] Still idle... ${remainingMinutes} minute(s) remaining before auto-submitting.`);
        }
      } else {
        // If UI is in an unexpected transition, reset timer
        if (idleStartTime !== null) {
          idleStartTime = null;
        }
      }

      scheduleNext(CONFIG.POLL_DELAY_MS);

    } catch (err) {
      console.error("[Auto-Continue] Error:", err);
      scheduleNext(CONFIG.POLL_DELAY_MS * 2);
    } finally {
      isExecuting = false;
    }
  }

  window.__claudeAutoContinue = { stop: cleanup };
  window.stopAuto = cleanup;
  window.addEventListener('beforeunload', cleanup, { once: true });

  console.log("%c[Auto-Continue] Started! " + (CONFIG.IDLE_WAIT_MS / 60000) + "-minute idle guard active.", "color: #38bdf8; font-weight: bold;");
  console.log("%cRun stopAuto() at any time to cancel.", "color: orange;");
  scheduleNext(1000);
})();
