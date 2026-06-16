'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const highscoresEl = document.getElementById('highscores');
const nameEntryEl = document.getElementById('name-entry');
const nameInputEl = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const startScreen = document.getElementById('start-screen');
const startHighscoresEl = document.getElementById('start-highscores');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');

const HS_KEY = 'tetris.highscores';
const HS_MAX = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, maxCombo, savedThisRun, lastSavedIndex;

/* ---- High-scores persistence ---- */
function loadHighscores() {
  try {
    const raw = localStorage.getItem(HS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(e => e && typeof e === 'object')
      .map(e => ({
        name: typeof e.name === 'string' ? e.name : '???',
        score: Number(e.score) || 0,
        lines: Number(e.lines) || 0,
        combo: Number(e.combo) || 0,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, HS_MAX);
  } catch {
    return [];
  }
}

function saveHighscores(list) {
  try {
    localStorage.setItem(HS_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore */
  }
}

function qualifies(scoreVal) {
  if (scoreVal <= 0) return false;
  const list = loadHighscores();
  return list.length < HS_MAX || scoreVal > list[list.length - 1].score;
}

function addHighscore(entry) {
  const list = loadHighscores();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const trimmed = list.slice(0, HS_MAX);
  const index = trimmed.indexOf(entry);
  saveHighscores(trimmed);
  return index;
}

function resetRecords() {
  saveHighscores([]);
  renderHighscores(startHighscoresEl, -1);
  renderHighscores(highscoresEl, -1);
}

function renderHighscores(target, highlightIndex) {
  if (!target) return;
  const list = loadHighscores();
  const bestCombo = list.reduce((m, e) => Math.max(m, e.combo), 0);
  const maxLines = list.reduce((m, e) => Math.max(m, e.lines), 0);

  let html = `<div class="stats">` +
    `<div>BEST COMBO <span>${bestCombo}</span></div>` +
    `<div>MAX LINES <span>${maxLines}</span></div>` +
    `</div>`;

  html += `<table><caption>HIGH SCORES</caption>` +
    `<thead><tr><th>#</th><th>Name</th><th>Score</th><th>Lines</th><th>Combo</th></tr></thead><tbody>`;

  if (list.length === 0) {
    html += `<tr><td class="empty" colspan="5">Sin récords todavía</td></tr>`;
  } else {
    list.forEach((e, i) => {
      const cls = i === highlightIndex ? ' class="current"' : '';
      html += `<tr${cls}><td>${i + 1}</td><td>${escapeHtml(e.name)}</td>` +
        `<td>${e.score.toLocaleString()}</td><td>${e.lines}</td><td>${e.combo}</td></tr>`;
    });
  }
  html += `</tbody></table>`;
  target.innerHTML = html;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    updateHUD();
  } else {
    combo = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent =
    `Puntuación: ${score.toLocaleString()} · Mejor combo: ${maxCombo}`;
  savedThisRun = false;
  lastSavedIndex = -1;

  if (qualifies(score)) {
    nameEntryEl.classList.remove('hidden');
    nameInputEl.value = '';
    renderHighscores(highscoresEl, -1);
    overlay.classList.remove('hidden');
    nameInputEl.focus();
  } else {
    nameEntryEl.classList.add('hidden');
    renderHighscores(highscoresEl, -1);
    overlay.classList.remove('hidden');
  }
}

function saveCurrentScore() {
  if (savedThisRun) return;
  const name = (nameInputEl.value || '').trim().slice(0, 10) || 'AAA';
  const entry = { name, score, lines, combo: maxCombo };
  lastSavedIndex = addHighscore(entry);
  savedThisRun = true;
  nameEntryEl.classList.add('hidden');
  renderHighscores(highscoresEl, lastSavedIndex);
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  combo = 0;
  maxCombo = 0;
  savedThisRun = false;
  lastSavedIndex = -1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  startScreen.classList.add('hidden');
  nameEntryEl.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function showStartScreen() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlay.classList.add('hidden');
  renderHighscores(startHighscoresEl, -1);
  startScreen.classList.remove('hidden');
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
playBtn.addEventListener('click', init);
resetRecordsBtn.addEventListener('click', resetRecords);
saveScoreBtn.addEventListener('click', saveCurrentScore);
nameInputEl.addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    e.preventDefault();
    saveCurrentScore();
  }
});

showStartScreen();
