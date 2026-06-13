const { JSDOM } = require('jsdom');
const fs = require('fs');

const dom = new JSDOM(`
  <!DOCTYPE html><html><body>
    <div id="activationsList"></div>
    <div id="platformSplitEditor"></div>
    <div id="splitTotal"></div>
    <div id="splitTotalUSD"></div>
    <div id="splitWarning"></div>
    <div id="splitCountryLabel"></div>
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
window.renderPlatformSplits();

function assertSum(desc) {
  const splits = window.appState.platformSplits;
  const sum = Object.values(splits).reduce((a,b) => a+b, 0);
  if (Math.abs(sum - 100) > 0.001) {
    console.error(`FAIL: ${desc} - Sum is ${sum}, splits:`, splits);
    process.exit(1);
  }
}

function dumpSplits() {
    return Object.assign({}, window.appState.platformSplits);
}

console.log("Initial:", dumpSplits());

// Edge Case 1: All locked
window.appState.lockedPlatforms = { TikTok: true, Instagram: true, YouTube: true, Facebook: true };
window.onSplitSlider('TikTok', 50);
console.log("After sliding all-locked TikTok to 50:", dumpSplits());
assertSum("All locked");

// Edge Case 2: Negative input
window.appState.lockedPlatforms = {};
window.onSplitSlider('TikTok', -10);
console.log("After sliding to -10:", dumpSplits());
assertSum("Negative input");

// Edge Case 3: Over 100
window.onSplitSlider('TikTok', 150);
console.log("After sliding to 150:", dumpSplits());
assertSum("Over 100");

// Edge Case 4: Sliding a locked slider (not all locked)
window.appState.platformSplits = { TikTok: 25, Instagram: 25, YouTube: 25, Facebook: 25 };
window.appState.lockedPlatforms = { TikTok: true, Instagram: true };
window.onSplitSlider('TikTok', 50);
console.log("After sliding locked TikTok to 50:", dumpSplits());
assertSum("Sliding locked slider");

// Edge Case 5: Floating point edge case when currentSumOthers > 0
window.appState.platformSplits = { TikTok: 10, Instagram: 30, YouTube: 30, Facebook: 30 };
window.appState.lockedPlatforms = {};
window.onSplitSlider('TikTok', 11);
console.log("After sliding TikTok to 11 (30,30,30 => sum 90, remainder 89):", dumpSplits());
assertSum("Floating point remainder 89/3");

// Edge Case 6: Sliding to 100
window.onSplitSlider('TikTok', 100);
console.log("After sliding TikTok to 100:", dumpSplits());
assertSum("Sliding to 100");

// Now try sliding something else
window.onSplitSlider('Instagram', 10);
console.log("After sliding Instagram to 10 from 0,0,0:", dumpSplits());
assertSum("Recovering from 0");

// Edge Case 7: Zombie Budget Creep
window.appState.platformSplits = { TikTok: 50, Instagram: 50, YouTube: 0, Facebook: 0 };
window.appState.lockedPlatforms = {};
window.onSplitSlider('TikTok', 40);
console.log("After sliding TikTok to 40 from 50 (with YouTube/Facebook at 0):", dumpSplits());
assertSum("Zombie Budget Creep");
if (window.appState.platformSplits.YouTube !== 0 || window.appState.platformSplits.Facebook !== 0) {
  console.error("FAIL: Zombie Budget Creep detected. YouTube or Facebook gained budget:", dumpSplits());
  process.exit(1);
}

// Random Fuzzing
console.log("\nStarting random fuzzing...");
window.appState.lockedPlatforms = {};
window.appState.platformSplits = { TikTok: 25, Instagram: 25, YouTube: 25, Facebook: 25 };
const platforms = ['TikTok', 'Instagram', 'YouTube', 'Facebook'];

for (let i = 0; i < 1000; i++) {
  const p = platforms[Math.floor(Math.random() * platforms.length)];
  const val = Math.floor(Math.random() * 110) - 5; // -5 to 105
  // randomly lock/unlock
  if (Math.random() < 0.2) {
    window.appState.lockedPlatforms[p] = !window.appState.lockedPlatforms[p];
  }
  window.onSplitSlider(p, val);
  
  const sum = Object.values(window.appState.platformSplits).reduce((a,b) => a+b, 0);
  if (Math.abs(sum - 100) > 0.001) {
    console.error(`FUZZ FAIL at iter ${i}: sum is ${sum}. Changed ${p} to ${val}. Splits:`, dumpSplits());
    console.error(`Locks:`, window.appState.lockedPlatforms);
    process.exit(1);
  }
  
  // also verify no split is negative
  for (let k of platforms) {
      if (window.appState.platformSplits[k] < 0) {
          console.error(`FUZZ FAIL NEGATIVE at iter ${i}: ${k} is ${window.appState.platformSplits[k]}`);
          process.exit(1);
      }
      // wait, they could be NaN
      if (Number.isNaN(window.appState.platformSplits[k])) {
          console.error(`FUZZ FAIL NaN at iter ${i}: ${k} is NaN`);
          process.exit(1);
      }
  }
}
console.log("Fuzzing passed.");
