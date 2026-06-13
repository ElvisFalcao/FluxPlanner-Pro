const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`
  <!DOCTYPE html><html><body>
    <div id="activationsList"></div>
    <div id="platformSplitEditor"></div>
    <div id="splitCountryLabel"></div>
    <div id="splitTotal"></div>
    <div id="splitTotalUSD"></div>
    <div id="splitWarning"></div>
    <div id="activationBudgetTotal"></div>
    <div id="activationBudgetWarning"></div>
  </body></html>
`, { runScripts: "dangerously" });

const scripts = ['data.js', 'budget-engine.js', 'app.js'];
scripts.forEach(file => {
  const code = fs.readFileSync(file, 'utf8');
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = code;
  dom.window.document.body.appendChild(scriptEl);
});

const window = dom.window;
window.appState.totalBudget = 1000;
window.appState.country = 'US';

// What if the sum initially is > 100 ?
window.appState.platformSplits = { TikTok: 50, Instagram: 50, YouTube: 50, Facebook: 50 };
window.appState.lockedPlatforms = {};

window.onSplitSlider('TikTok', 60);
console.log("After sliding TikTok to 60 (initial sum 200):", window.appState.platformSplits);

